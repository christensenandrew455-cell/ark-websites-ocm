import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "./firebase-admin";

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

export async function deleteCustomerPermanently(clientId) {
  const { db, businessRef, business } = await readCustomer(clientId);
  const uid = text(business.uid);
  const adminClientId = text(process.env.ARK_ADMIN_CLIENT_ID || "ark-ocm");

  await Promise.all([
    db.recursiveDelete(db.collection("ocmClients").doc(clientId)),
    deleteQueryDocuments(db.collection("supportRequests").where("clientId", "==", clientId)),
    deleteQueryDocuments(db.collection("stripeWebhookEvents").where("clientId", "==", clientId)),
  ]);

  const batch = db.batch();
  batch.delete(businessRef);
  batch.delete(db.collection("connections").doc(clientId));
  if (uid) batch.delete(db.collection("accounts").doc(uid));
  if (adminClientId && adminClientId !== clientId) {
    batch.delete(db.collection("ocmClients").doc(adminClientId).collection("clients").doc(clientId));
  }
  await batch.commit();

  if (uid) await getAdminAuth().deleteUser(uid).catch((error) => {
    if (error?.code !== "auth/user-not-found") throw error;
  });

  return { clientId, deleted: true };
}
