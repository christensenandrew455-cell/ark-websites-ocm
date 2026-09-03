import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { isStandardRole } from "./accountRoles.js";
import { getAdminAuth, getAdminDb } from "./firebase-admin.js";
import {
  deletePendingOwnerSignup,
  pendingOwnerSignupExpired,
  pendingOwnerSignupPersonalization,
  pendingOwnerSignupVerified,
  readPendingOwnerSignup,
} from "./pendingOwnerSignup.js";
import { normalizeClientId } from "./valueUtils.js";

function text(value) { return String(value || "").trim(); }
function uuid(value) {
  const normalized = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized) ? normalized : "";
}
function errorResponse(message = "Apple billing could not be opened.", status = 403) {
  return NextResponse.json({ error: message }, { status });
}

export async function authorizeAppleBillingRequest(request, { allowPending = true } = {}) {
  const header = text(request.headers.get("authorization"));
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { response: errorResponse("Sign in to continue.", 401) };

  const auth = getAdminAuth();
  const db = getAdminDb();
  try {
    const decoded = await auth.verifyIdToken(token, true);
    const clientId = normalizeClientId(decoded.clientId);
    if (!isStandardRole(decoded.role) || !clientId) return { response: errorResponse() };
    const pendingToken = decoded.temporaryAccount === true || text(decoded.accountStatus) === "pending_payment";
    if (pendingToken) {
      if (!allowPending || decoded.temporaryAccount !== true || text(decoded.accountStatus) !== "pending_payment") {
        return { response: errorResponse() };
      }
      const pending = await readPendingOwnerSignup({ db, uid: decoded.uid, clientId, allowExpired: true });
      if (pending && pendingOwnerSignupExpired(pending.data)) {
        await deletePendingOwnerSignup({ db, auth, uid: decoded.uid, pending });
        return { response: errorResponse("This temporary signup expired. Start signup again.", 410) };
      }
      if (!pending || !pendingOwnerSignupVerified(pending.data) || text(pending.data.stage) !== "pending_payment") {
        return { response: errorResponse() };
      }
      if (pendingOwnerSignupPersonalization(pending.data).notificationPreferencesCompleted !== true) {
        return { response: errorResponse("Choose where to receive notifications before payment.", 409) };
      }
      return { kind: "pending", auth, db, decoded, clientId, pending };
    }

    const accountRef = db.collection("accounts").doc(clientId);
    const accountSnapshot = await accountRef.get();
    if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(decoded.uid)) {
      return { response: errorResponse("This account could not be found.", 404) };
    }
    return { kind: "active", auth, db, decoded, clientId, accountRef, account: accountSnapshot.data() };
  } catch (error) {
    console.error("Unable to authorize Apple billing", error);
    return { response: errorResponse("Your session expired. Sign in again.", 401) };
  }
}

export async function ensureAppleAppAccountToken(access) {
  if (access.kind === "pending") {
    const payment = access.pending.data.payment || {};
    const existing = uuid(payment.appleAppAccountToken);
    if (existing) return existing;
    const created = randomUUID().toLowerCase();
    await access.pending.ref.set({
      payment: { ...payment, appleAppAccountToken: created, appleStatus: "ready" },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    access.pending.data.payment = { ...payment, appleAppAccountToken: created, appleStatus: "ready" };
    return created;
  }
  const existing = uuid(access.account.appleAppAccountToken);
  if (!existing) throw new Error("APPLE_IAP_ACCOUNT_TOKEN_MISSING");
  return existing;
}

export function sameAppleAccountToken(left, right) {
  const first = uuid(left);
  return Boolean(first) && first === uuid(right);
}
