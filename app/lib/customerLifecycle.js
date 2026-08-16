import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { getAdminAuth, getAdminBucket, getAdminDb } from "./firebase-admin";
import { systemCollection } from "./firestoreLayout.js";
import { pendingOwnerSignupRef } from "./pendingOwnerSignup";
import { missingStripeResource } from "./stripeUsageBilling";

function text(value) { return String(value || "").trim(); }

async function readCustomer(clientId) {
  const db = getAdminDb();
  const businessRef = db.collection("accounts").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) throw new Error("That customer account does not exist.");
  return { db, businessRef, business: businessSnapshot.data() };
}

export async function disableCustomer(clientId, actorUid, extra = {}) {
  const { db, businessRef, business } = await readCustomer(clientId);
  const uid = text(business.uid);
  if (uid) await getAdminAuth().updateUser(uid, { disabled: true }).catch(() => null);
  await businessRef.set({
    status: "disabled",
    enabled: false,
    receptionistEnabled: false,
    disabledAt: FieldValue.serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true });
  return { clientId, status: "disabled" };
}

export async function restoreCustomer(clientId, actorUid) {
  const { businessRef, business } = await readCustomer(clientId);
  if (business.billingPastDue === true) {
    const error = new Error("This account is disabled for payment. It restores automatically only after payment succeeds.");
    error.code = "PAYMENT_RESTRICTED";
    throw error;
  }
  const uid = text(business.uid);
  if (uid) await getAdminAuth().updateUser(uid, { disabled: false });
  await businessRef.set({
    status: "active",
    enabled: true,
    receptionistEnabled: business.receptionistPhoneNormalized ? true : business.receptionistEnabled !== false,
    disabledAt: FieldValue.delete(),
    disabledBy: FieldValue.delete(),
    deletionScheduledFor: FieldValue.delete(),
    deletionScheduledBy: FieldValue.delete(),
    updatedBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { clientId, status: "active" };
}

async function deleteQueryDocuments(query) {
  const snapshot = await query.get();
  if (!snapshot.size) return;
  const db = getAdminDb();
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 400).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

async function deleteStripeAccount(business) {
  const customerId = text(business.stripeCustomerId);
  const subscriptionId = text(business.stripeSubscriptionId);
  if (!customerId && !subscriptionId) return;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is required to remove this account's billing data.");
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  if (customerId) {
    try {
      await stripe.customers.del(customerId);
      return;
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
    }
  }
  if (subscriptionId) {
    try { await stripe.subscriptions.cancel(subscriptionId); } catch (error) { if (!missingStripeResource(error)) throw error; }
  }
}

async function deleteSupportRequests(db, clientId) {
  const snapshot = await systemCollection(db, "supportRequests").where("clientId", "==", clientId).get();
  const storagePaths = snapshot.docs.map((document) => text(document.data()?.attachment?.storagePath)).filter(Boolean);
  if (storagePaths.length) {
    const bucket = getAdminBucket();
    await Promise.all(storagePaths.map((storagePath) => bucket.file(storagePath).delete({ ignoreNotFound: true })));
  }
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 400).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

async function deleteReferralData(db, clientId) {
  const [asReferrer, asReferred, ownedPeriods, creditedPeriods] = await Promise.all([
    systemCollection(db, "referrals").where("referrerClientId", "==", clientId).get(),
    systemCollection(db, "referrals").where("referredClientId", "==", clientId).get(),
    systemCollection(db, "referralPeriods").where("referrerClientId", "==", clientId).get(),
    systemCollection(db, "referralPeriods").where("referredClientIds", "array-contains", clientId).get(),
  ]);
  const deleteRefs = new Map();
  [...asReferrer.docs, ...asReferred.docs, ...ownedPeriods.docs].forEach((document) => deleteRefs.set(document.ref.path, document.ref));
  for (let index = 0; index < [...deleteRefs.values()].length; index += 350) {
    const batch = db.batch();
    [...deleteRefs.values()].slice(index, index + 350).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  for (let index = 0; index < creditedPeriods.docs.length; index += 350) {
    const documents = creditedPeriods.docs.slice(index, index + 350).filter((document) => !deleteRefs.has(document.ref.path));
    if (!documents.length) continue;
    const batch = db.batch();
    documents.forEach((document) => {
      const current = Math.max(0, Number(document.data().qualifiedCount || 0));
      batch.set(document.ref, {
        referredClientIds: FieldValue.arrayRemove(clientId),
        qualifiedCount: Math.max(0, current - 1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  }
}

export async function deleteCustomerPermanently(clientId) {
  const { db, businessRef, business } = await readCustomer(clientId);
  const uid = text(business.uid);
  await deleteStripeAccount(business);
  await deleteSupportRequests(db, clientId);
  if (uid) await getAdminAuth().deleteUser(uid).catch((error) => { if (error?.code !== "auth/user-not-found") throw error; });
  await deleteReferralData(db, clientId);
  await Promise.all([
    db.recursiveDelete(businessRef),
    pendingOwnerSignupRef(db, clientId).delete().catch(() => null),
    deleteQueryDocuments(systemCollection(db, "stripeWebhookEvents").where("clientId", "==", clientId)),
    deleteQueryDocuments(systemCollection(db, "messagingComplianceEvents").where("clientId", "==", clientId)),
    deleteQueryDocuments(systemCollection(db, "deletedAccountAudit").where("clientId", "==", clientId)),
  ]);
  return { clientId, deleted: true };
}
