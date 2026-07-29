import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";
import { requireUser } from "../../../lib/userRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function text(value) { return String(value || "").trim(); }

export async function POST(request) {
  const user = await requireUser(request);
  if (user.response) return user.response;
  const decoded = user.decodedToken;
  const clientId = text(decoded.businessClientId || decoded.clientId);
  if (decoded.role !== "employee" || !clientId) return NextResponse.json({ error: "An employee account is required." }, { status: 403 });

  try {
    const db = getAdminDb();
    const auth = getAdminAuth();
    const accountRef = db.collection("accounts").doc(decoded.uid);
    const businessRef = db.collection("businesses").doc(clientId);
    const employeeRef = businessRef.collection("employees").doc(decoded.uid);
    const root = db.collection("ocmClients").doc(clientId);
    const employeeSnapshot = await employeeRef.get();

    const [contactedSnapshot, clientsSnapshot, conversationsSnapshot] = await Promise.all([
      root.collection("contactedMe").where("assignedEmployeeUid", "==", decoded.uid).get(),
      root.collection("clients").where("assignedEmployeeUid", "==", decoded.uid).get(),
      root.collection("leadConversations").where("assignedEmployeeUid", "==", decoded.uid).get(),
    ]);

    const batch = db.batch();
    const unassigned = { assignedEmployeeUid: null, assignedEmployeeName: null, assignedAt: null, updatedAt: FieldValue.serverTimestamp() };
    contactedSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
    clientsSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
    conversationsSnapshot.docs.forEach((document) => batch.set(document.ref, unassigned, { merge: true }));
    batch.delete(accountRef);
    batch.delete(employeeRef);
    const nameKey = text(employeeSnapshot.exists ? employeeSnapshot.data().employeeNameKey : "");
    if (nameKey) batch.delete(businessRef.collection("employeeHandles").doc(nameKey));
    await batch.commit();
    await auth.deleteUser(decoded.uid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to delete employee account", error);
    return NextResponse.json({ error: "Could not delete your account." }, { status: 500 });
  }
}
