import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";
import { getAdminAuth, getAdminBucket, getAdminDb } from "./firebase-admin";
import { accountPhoneRegistryId } from "./signupAvailability";
import { missingStripeResource } from "./stripeUsageBilling";
import { normalizeClientId } from "./valueUtils";

function text(value) {
  return String(value || "").trim();
}

async function readCustomer(clientId) {
  const db = getAdminDb();
  const businessRef = db.collection("businesses").doc(clientId);
  const businessSnapshot = await businessRef.get();
  if (!businessSnapshot.exists) throw new Error("That customer account does not exist.");
  return { db, businessRef, business: businessSnapshot.data() };
}

async function updateAdminCustomerRecord(db, clientId, data) {
  const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
  if (!adminClientId || adminClientId === clientId) return;
  await db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId).set(data, { merge: true }).catch(() => null);
}

export async function disableCustomer(clientId, actorUid, extra = {}) {
  const { db, businessRef, business } = await readCustomer(clientId);
  const uid = text(business.uid);
  if (uid) await getAdminAuth().updateUser(uid, { disabled: true }).catch(() => null);

  const batch = db.batch();
  batch.set(businessRef, {
    status: "disabled",
    disabledAt: FieldValue.serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true });
  if (uid) {
    batch.set(db.collection("accounts").doc(uid), {
      status: "disabled",
      disabledAt: FieldValue.serverTimestamp(),
      disabledBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      ...extra,
    }, { merge: true });
  }
  batch.set(db.collection("connections").doc(clientId), {
    enabled: false,
    disabledAt: FieldValue.serverTimestamp(),
    disabledBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), {
    status: "disabled",
    disabledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...extra,
  }, { merge: true });
  await batch.commit();
  await updateAdminCustomerRecord(db, clientId, { AccountStatus: "disabled", updatedAt: FieldValue.serverTimestamp() });
  return { clientId, status: "disabled" };
}

export async function restoreCustomer(clientId, actorUid) {
  const { db, businessRef, business } = await readCustomer(clientId);
  const uid = text(business.uid);
  if (uid) await getAdminAuth().updateUser(uid, { disabled: false });

  const restored = {
    status: "active",
    disabledAt: FieldValue.delete(),
    disabledBy: FieldValue.delete(),
    deletionScheduledFor: FieldValue.delete(),
    deletionScheduledBy: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.set(businessRef, restored, { merge: true });
  if (uid) batch.set(db.collection("accounts").doc(uid), restored, { merge: true });
  batch.set(db.collection("connections").doc(clientId), {
    enabled: true,
    disabledAt: FieldValue.delete(),
    disabledBy: FieldValue.delete(),
    deletionScheduledFor: FieldValue.delete(),
    deletionScheduledBy: FieldValue.delete(),
    updatedBy: actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(db.collection("ocmClients").doc(clientId), restored, { merge: true });
  await batch.commit();
  await updateAdminCustomerRecord(db, clientId, { AccountStatus: "active", updatedAt: FieldValue.serverTimestamp() });
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
    try {
      await stripe.subscriptions.cancel(subscriptionId);
    } catch (error) {
      if (!missingStripeResource(error)) throw error;
    }
  }
}

async function deleteSupportRequests(db, clientId) {
  const snapshot = await db.collection("supportRequests").where("clientId", "==", clientId).get();
  const storagePaths = snapshot.docs
    .map((document) => text(document.data()?.attachment?.storagePath))
    .filter(Boolean);
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
    db.collection("referrals").where("referrerClientId", "==", clientId).get(),
    db.collection("referrals").where("referredClientId", "==", clientId).get(),
    db.collection("referralPeriods").where("referrerClientId", "==", clientId).get(),
    db.collection("referralPeriods").where("referredClientIds", "array-contains", clientId).get(),
  ]);
  const deleteRefs = new Map();
  [...asReferrer.docs, ...asReferred.docs, ...ownedPeriods.docs].forEach((document) => deleteRefs.set(document.ref.path, document.ref));
  for (let index = 0; index < [...deleteRefs.values()].length; index += 350) {
    const batch = db.batch();
    [...deleteRefs.values()].slice(index, index + 350).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  for (let index = 0; index < creditedPeriods.docs.length; index += 350) {
    const documents = creditedPeriods.docs
      .slice(index, index + 350)
      .filter((document) => !deleteRefs.has(document.ref.path));
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
  const uid = text(business.uid || business.ownerUid);
  const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");
  const businessNameKey = normalizeClientId(business.businessNameKey || business.businessName || clientId);
  const connectionSnapshot = await db.collection("connections").doc(clientId).get();
  const accountSnapshots = await db.collection("accounts").where("clientId", "==", clientId).get();
  const accountDocuments = new Map();
  accountSnapshots.docs.forEach((document) => accountDocuments.set(document.id, document));
  if (uid && !accountDocuments.has(uid)) {
    const ownerSnapshot = await db.collection("accounts").doc(uid).get();
    if (ownerSnapshot.exists) accountDocuments.set(uid, ownerSnapshot);
  }
  const authUids = [...new Set([uid, ...accountDocuments.keys()].filter(Boolean))];
  const phoneRegistryIds = [...new Set([...accountDocuments.values(), { data: () => business }]
    .map((document) => accountPhoneRegistryId(document.data()?.accountPhoneNormalized || document.data()?.accountPhone))
    .filter(Boolean))];
  const connectionPhoneIds = [...new Set([
    accountPhoneRegistryId(connectionSnapshot.exists ? connectionSnapshot.data().receptionistPhoneNormalized || connectionSnapshot.data().receptionistPhone : ""),
    accountPhoneRegistryId(business.approvalReservationPhoneNormalized),
  ].filter(Boolean))];

  await deleteStripeAccount(business);
  await deleteSupportRequests(db, clientId);
  await Promise.all(authUids.map((accountUid) => getAdminAuth().deleteUser(accountUid).catch((error) => {
    if (error?.code !== "auth/user-not-found") throw error;
  })));
  await deleteReferralData(db, clientId);

  await Promise.all([
    db.recursiveDelete(businessRef),
    db.recursiveDelete(db.collection("ocmClients").doc(clientId)),
    deleteQueryDocuments(db.collection("stripeWebhookEvents").where("clientId", "==", clientId)),
    deleteQueryDocuments(db.collection("messagingComplianceEvents").where("clientId", "==", clientId)),
    deleteQueryDocuments(db.collection("deletedAccountAudit").where("clientId", "==", clientId)),
    deleteQueryDocuments(db.collection("businessNameRegistry").where("clientId", "==", clientId)),
  ]);

  const batch = db.batch();
  batch.delete(db.collection("connections").doc(clientId));
  accountDocuments.forEach((document, accountUid) => batch.delete(db.collection("accounts").doc(accountUid)));
  authUids.forEach((accountUid) => batch.delete(db.collection("accountVerificationChallenges").doc(accountUid)));
  if (uid) batch.delete(db.collection("accounts").doc(uid));
  if (businessNameKey) batch.delete(db.collection("businessNameRegistry").doc(businessNameKey));
  phoneRegistryIds.forEach((phoneId) => batch.delete(db.collection("accountPhoneRegistry").doc(phoneId)));
  connectionPhoneIds.forEach((phoneId) => batch.delete(db.collection("connectionPhoneRegistry").doc(phoneId)));
  if (adminClientId && adminClientId !== clientId) {
    batch.delete(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId));
  }
  await batch.commit();

  return { clientId, deleted: true };
}
