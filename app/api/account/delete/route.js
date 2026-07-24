import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";
import { normalizeClientId } from "../../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  if (decoded.role !== "customer" || !decoded.clientId) return NextResponse.json({ error: "An owner account is required." }, { status: 403 });

  try {
    const db = getAdminDb();
    const auth = getAdminAuth();
    const accountRef = db.collection("accounts").doc(decoded.uid);
    const businessRef = db.collection("businesses").doc(text(decoded.clientId));
    const [accountSnapshot, businessSnapshot] = await Promise.all([accountRef.get(), businessRef.get()]);
    if (!accountSnapshot.exists || !businessSnapshot.exists) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    const account = accountSnapshot.data();
    const business = businessSnapshot.data();
    const body = await request.json();
    const confirmation = text(body.confirmation);
    const expected = text(business.businessName || account.businessName);
    if (!confirmation || confirmation.toLowerCase() !== expected.toLowerCase()) return NextResponse.json({ error: `Type ${expected} exactly to confirm deletion.` }, { status: 400 });

    const employeesSnapshot = await businessRef.collection("employees").get();
    const employeeUids = employeesSnapshot.docs.map((document) => document.id);
    const subscriptionId = text(business.stripeSubscriptionId || account.stripeSubscriptionId);
    if (subscriptionId && process.env.STRIPE_SECRET_KEY) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      await stripe.subscriptions.cancel(subscriptionId).catch((error) => console.error("Unable to cancel deleted account subscription", error));
    }

    await db.collection("deletedAccountAudit").doc(`${decoded.uid}-${Date.now()}`).set({
      uid: decoded.uid,
      clientId: text(decoded.clientId),
      businessName: expected,
      accountEmail: text(account.accountEmail),
      stripeCustomerId: text(business.stripeCustomerId || account.stripeCustomerId) || null,
      stripeSubscriptionId: subscriptionId || null,
      deletedAt: FieldValue.serverTimestamp(),
      deletionSource: "owner-settings",
    });

    await Promise.all([
      db.recursiveDelete(db.collection("ocmClients").doc(text(decoded.clientId))),
      db.recursiveDelete(businessRef),
    ]);
    const batch = db.batch();
    batch.delete(accountRef);
    batch.delete(db.collection("businessNameRegistry").doc(normalizeClientId(expected)));
    employeeUids.forEach((uid) => batch.delete(db.collection("accounts").doc(uid)));
    await batch.commit();

    await Promise.all(employeeUids.map((uid) => auth.deleteUser(uid).catch(() => null)));
    await auth.deleteUser(decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to delete owner account", error);
    return NextResponse.json({ error: "Could not delete the account. Contact support before trying again." }, { status: 500 });
  }
}
