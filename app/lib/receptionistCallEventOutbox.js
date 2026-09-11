import { sendAdminEvent } from "./adminEvents.js";
import { systemCollection } from "./firestoreLayout.js";

function millis(value) {
  return typeof value?.toMillis === "function" ? value.toMillis() : new Date(value || 0).getTime();
}

export async function flushReceptionistCallEvents({ db, eventId, limit = 20, now = Date.now(), send = sendAdminEvent }) {
  const outbox = systemCollection(db, "receptionistCallEventOutbox");
  const documents = eventId
    ? [await outbox.doc(eventId).get()]
    : (await outbox.where("nextAttemptAt", "<=", new Date(now)).limit(limit).get()).docs;
  const result = { delivered: 0, pending: 0 };
  for (const document of documents) {
    if (!document.exists) continue;
    const ref = document.ref;
    try {
      const claim = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return null;
        const row = snapshot.data();
        if (millis(row.expiresAt) <= now) {
          transaction.delete(ref);
          return null;
        }
        if (millis(row.nextAttemptAt) > now) return null;
        const attempts = Number(row.attempts || 0) + 1;
        transaction.update(ref, { attempts, nextAttemptAt: new Date(now + 60_000) });
        return { event: row.event, attempts };
      });
      if (!claim) continue;
      // Stable event IDs also deduplicate Admin records and Android push deliveries.
      const delivery = await send(claim.event).catch(() => ({ delivered: false }));
      if (delivery.delivered) {
        await ref.delete();
        result.delivered += 1;
      } else {
        await ref.update({ nextAttemptAt: new Date(now + Math.min(15 * 60_000, 5_000 * 2 ** Math.min(claim.attempts, 8))) });
        result.pending += 1;
        console.warn("ARK call notification queued for retry", { eventId: document.id });
      }
    } catch (error) {
      result.pending += 1;
      console.warn("ARK call notification retry failed", error?.message);
    }
  }
  return result;
}

export async function cleanupReceptionistCallState({ db, now = Date.now() }) {
  let deleted = 0;
  for (const name of ["receptionistCallerCooldowns", "receptionistCallAdmissions", "receptionistCallEventOutbox"]) {
    const expired = await systemCollection(db, name).where("expiresAt", "<=", new Date(now)).limit(200).get();
    // Check again in a transaction: a caller may have renewed an expired timer
    // between the query and cleanup. Never delete that newly acquired cooldown.
    for (const document of expired.docs) {
      deleted += await db.runTransaction(async (transaction) => {
        const latest = await transaction.get(document.ref);
        if (!latest.exists || millis(latest.data().expiresAt) > now) return 0;
        transaction.delete(document.ref);
        return 1;
      });
    }
  }
  return deleted;
}
