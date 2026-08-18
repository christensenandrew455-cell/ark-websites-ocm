export const TOP_LEVEL_COLLECTIONS = Object.freeze({
  ACCOUNTS: "accounts",
  PENDING_SIGNUPS: "pendingOwnerSignups",
  SYSTEM: "system",
});

const SYSTEM_DOCUMENT_ID = "global";

function text(value) {
  return String(value || "").trim();
}

export function accountRef(db, clientId) {
  const id = text(clientId);
  if (!id) throw new Error("ACCOUNT_CLIENT_ID_REQUIRED");
  return db.collection(TOP_LEVEL_COLLECTIONS.ACCOUNTS).doc(id);
}

export function accountCollection(db) {
  return db.collection(TOP_LEVEL_COLLECTIONS.ACCOUNTS);
}

export function accountPrivateRef(db, clientId, documentId) {
  return accountRef(db, clientId).collection("private").doc(text(documentId));
}

export function accountBusinessRef(db, clientId) {
  return accountRef(db, clientId).collection("business").doc("profile");
}

export function accountCustomizationRef(db, clientId) {
  return accountRef(db, clientId).collection("customization").doc("preferences");
}

export function accountHelpRef(db, clientId) {
  return accountRef(db, clientId).collection("help").doc("current");
}

export function pendingSignupCollection(db) {
  return db.collection(TOP_LEVEL_COLLECTIONS.PENDING_SIGNUPS);
}

export function systemCollection(db, name) {
  const collectionName = text(name);
  if (!collectionName) throw new Error("SYSTEM_COLLECTION_REQUIRED");
  return db.collection(TOP_LEVEL_COLLECTIONS.SYSTEM).doc(SYSTEM_DOCUMENT_ID).collection(collectionName);
}
