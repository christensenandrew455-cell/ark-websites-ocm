import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/adminRequest";
import {
  deleteCustomerPermanently,
  disableCustomer,
  restoreCustomer,
} from "../../../../lib/customerLifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) {
  return String(value || "").trim();
}

export async function POST(request) {
  const admin = await requireAdmin(request);
  if (admin.response) return admin.response;

  try {
    const body = await request.json();
    const clientId = text(body.clientId);
    const action = text(body.action);
    if (!clientId) return NextResponse.json({ error: "Choose a customer account." }, { status: 400 });

    let result;
    if (action === "disable") {
      result = await disableCustomer(clientId, admin.decodedToken.uid);
    } else if (action === "restore") {
      result = await restoreCustomer(clientId, admin.decodedToken.uid);
    } else if (action === "delete-now") {
      if (text(body.confirmation) !== clientId || body.confirmPermanent !== true) {
        return NextResponse.json({ error: "Confirm permanent deletion and type the exact client ID." }, { status: 400 });
      }
      result = await deleteCustomerPermanently(clientId);
    } else {
      return NextResponse.json({ error: "Choose Disable, Restore, or Delete Permanently." }, { status: 400 });
    }

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("Unable to update customer lifecycle", error);
    return NextResponse.json({ error: error.message || "Could not update the customer account." }, { status: 500 });
  }
}
