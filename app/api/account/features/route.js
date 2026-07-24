import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorizeOwner(request) {
  const user = await requireUser(request);
  if (user.response) return { response: user.response };
  const decoded = user.decodedToken;
  if (decoded.role !== "customer" || !decoded.clientId) return { response: NextResponse.json({ error: "An owner account is required." }, { status: 403 }) };
  const db = getAdminDb();
  const accountRef = db.collection("accounts").doc(decoded.uid);
  const accountSnapshot = await accountRef.get();
  if (!accountSnapshot.exists || accountSnapshot.data().status !== "active") return { response: NextResponse.json({ error: "An active owner account is required." }, { status: 403 }) };
  return { db, decoded, accountRef, account: accountSnapshot.data(), clientId: String(decoded.clientId) };
}

function flags(data = {}) {
  return {
    messagesEnabled: data.messagesEnabled === true,
    employeesEnabled: data.employeesEnabled === true,
    employeeMessagingEnabled: data.employeeMessagingEnabled === true && data.messagesEnabled === true && data.employeesEnabled === true,
  };
}

export async function GET(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  const businessSnapshot = await access.db.collection("businesses").doc(access.clientId).get();
  return NextResponse.json({ ok: true, ...flags(businessSnapshot.exists ? businessSnapshot.data() : access.account) });
}

export async function POST(request) {
  const access = await authorizeOwner(request);
  if (access.response) return access.response;
  try {
    const body = await request.json();
    const messagesEnabled = body.messagesEnabled === true;
    const employeesEnabled = body.employeesEnabled === true;
    const employeeMessagingEnabled = body.employeeMessagingEnabled === true && messagesEnabled && employeesEnabled;
    const update = { messagesEnabled, employeesEnabled, employeeMessagingEnabled, updatedAt: FieldValue.serverTimestamp() };
    const businessRef = access.db.collection("businesses").doc(access.clientId);
    const employeesSnapshot = await businessRef.collection("employees").get();
    const batch = access.db.batch();
    batch.set(businessRef, update, { merge: true });
    batch.set(access.accountRef, update, { merge: true });
    batch.set(access.db.collection("ocmClients").doc(access.clientId).collection("settings").doc("account"), {
      MessagesEnabled: messagesEnabled,
      EmployeesEnabled: employeesEnabled,
      EmployeeMessagingEnabled: employeeMessagingEnabled,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    for (const employee of employeesSnapshot.docs) {
      batch.set(employee.ref, update, { merge: true });
      batch.set(access.db.collection("accounts").doc(employee.id), update, { merge: true });
    }
    await batch.commit();

    const auth = getAdminAuth();
    const ownerRecord = await auth.getUser(access.decoded.uid);
    await auth.setCustomUserClaims(access.decoded.uid, { ...(ownerRecord.customClaims || {}), messagesEnabled, employeesEnabled, employeeMessagingEnabled });
    await Promise.all(employeesSnapshot.docs.map(async (employee) => {
      try {
        const record = await auth.getUser(employee.id);
        await auth.setCustomUserClaims(employee.id, { ...(record.customClaims || {}), messagesEnabled, employeesEnabled, employeeMessagingEnabled });
      } catch (error) {
        console.warn("Unable to refresh employee feature claims", employee.id, error);
      }
    }));

    return NextResponse.json({ ok: true, messagesEnabled, employeesEnabled, employeeMessagingEnabled });
  } catch (error) {
    console.error("Unable to update account features", error);
    return NextResponse.json({ error: "Could not update account features." }, { status: 500 });
  }
}
