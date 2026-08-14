import { FieldValue } from "firebase-admin/firestore";
import {
  accountVerificationDeadline,
  accountVerificationExpired,
  ownerAccountNeedsIdentityVerification,
} from "./accountVerificationDeadline";
import { deleteCustomerPermanently } from "./customerLifecycle";

function text(value) {
  return String(value || "").trim();
}

function candidate(document, now) {
  const account = document.data();
  const deadline = accountVerificationDeadline(account);
  if (!ownerAccountNeedsIdentityVerification(account) || !accountVerificationExpired(account, now) || !deadline) return null;
  const clientId = text(account.clientId);
  return clientId ? { document, clientId, deadline: deadline.getTime() } : null;
}

export async function purgeExpiredUnverifiedAccounts({ db, now = new Date(), maximum = 100 } = {}) {
  const snapshot = await db.collection("accounts").where("identityVerificationRequired", "==", true).get();
  const candidates = snapshot.docs
    .map((document) => candidate(document, now))
    .filter(Boolean)
    .sort((left, right) => left.deadline - right.deadline)
    .slice(0, Math.max(1, maximum));
  const result = { checked: snapshot.size, expired: candidates.length, deleted: 0, failed: 0 };

  for (const item of candidates) {
    const locked = await db.runTransaction(async (transaction) => {
      const latestSnapshot = await transaction.get(item.document.ref);
      if (!latestSnapshot.exists) return false;
      const latest = latestSnapshot.data();
      if (!ownerAccountNeedsIdentityVerification(latest) || !accountVerificationExpired(latest, now)) return false;
      transaction.set(item.document.ref, {
        verificationCleanupStatus: "deleting",
        verificationCleanupStartedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return text(latest.clientId) || item.clientId;
    });
    if (!locked) continue;

    try {
      await deleteCustomerPermanently(locked);
      result.deleted += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`Unable to delete expired unverified account ${item.document.id}`, error);
      await item.document.ref.set({
        verificationCleanupStatus: "retry_pending",
        verificationCleanupLastAttemptAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch(() => null);
    }
  }

  return result;
}
