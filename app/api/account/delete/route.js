import { NextResponse } from "next/server";
import { isStandardRole } from "../../../lib/accountRoles";
import { sendAdminEvent } from "../../../lib/adminEvents";
import { deleteCustomerPermanently } from "../../../lib/customerLifecycle";
import { getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  const clientId = text(decoded.clientId);
  if (!isStandardRole(decoded.role) || !clientId) return NextResponse.json({ error: "An owner account is required." }, { status: 403 });

  try {
    const db = getAdminDb();
    const accountSnapshot = await db.collection("accounts").doc(clientId).get();
    if (!accountSnapshot.exists || text(accountSnapshot.data().uid) !== text(decoded.uid)) return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    const account = accountSnapshot.data();
    const body = await request.json();
    const confirmation = text(body.confirmation);
    const expected = text(account.businessName);
    if (!confirmation || confirmation.toLowerCase() !== expected.toLowerCase()) return NextResponse.json({ error: `Type ${expected} exactly to confirm deletion.` }, { status: 400 });

    await deleteCustomerPermanently(clientId);
    try {
      const delivery = await sendAdminEvent({
        id: `account-deleted-${clientId}-${Date.now()}`,
        type: "account.deleted",
        clientId,
        businessName: expected || clientId,
        summary: `${expected || clientId} permanently deleted their ARC account.`,
        metadata: { deletedBy: "owner" },
      });
      if (!delivery.delivered) console.warn("Account deleted but Arc Admin notification was not delivered", clientId);
    } catch (eventError) {
      console.warn("Account deleted but Arc Admin notification was not delivered", clientId, eventError);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to delete owner account", error);
    return NextResponse.json({ error: "Something went wrong. Reload and try again." }, { status: 500 });
  }
}
