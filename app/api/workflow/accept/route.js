import { doc, getDoc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { resolveEstimateSchedule } from "../../../lib/businessTime";
import { normalizeJobs, updateCurrentJob } from "../../../lib/propertyProfiles";

const DEFAULT_CLIENT_ID = "tabor-painting";

function cleanClientId(value) {
  return String(value || DEFAULT_CLIENT_ID)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || DEFAULT_CLIENT_ID;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const clientId = cleanClientId(body.clientId);
    const id = String(body.id || "").trim();

    if (!id) {
      return Response.json({ ok: false, error: "Missing client record ID." }, { status: 400 });
    }

    const sourceRef = doc(db, "ocmClients", clientId, "contactedMe", id);
    const sourceSnapshot = await getDoc(sourceRef);
    if (!sourceSnapshot.exists()) {
      return Response.json({ ok: false, error: "Lead no longer exists." }, { status: 404 });
    }

    const lead = sourceSnapshot.data();
    const schedule = resolveEstimateSchedule(lead.PreferredDay, lead.PreferredTime, new Date());
    if (!schedule) {
      return Response.json(
        { ok: false, error: "This lead needs a valid estimate day and time before it can be accepted." },
        { status: 400 }
      );
    }

    const Jobs = updateCurrentJob(lead, "preClients", {
      estimateDate: schedule.estimateDate,
      estimateTime: schedule.estimateTime,
      status: "preClients",
    });
    const targetRef = doc(db, "ocmClients", clientId, "preClients", id);
    const batch = writeBatch(db);
    batch.set(targetRef, {
      ...lead,
      Jobs,
      TotalJobs: Jobs.length || normalizeJobs(lead, "preClients").length,
      RepeatJobs: Math.max(0, Jobs.length - 1),
      currentStage: "preClients",
      previousStage: "contactedMe",
      reviewStatus: "accepted",
      acceptedAt: serverTimestamp(),
      movedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      EstimateDate: schedule.estimateDate,
      EstimateTime: schedule.estimateTime,
      EstimateTimeZone: schedule.timeZone,
      EstimateDateTime: schedule.estimateAt.toISOString(),
      EstimateFollowUpAt: schedule.followUpAt.toISOString(),
      EstimateFollowUpDue: false,
    }, { merge: true });
    batch.delete(sourceRef);
    await batch.commit();

    return Response.json({
      ok: true,
      estimateDate: schedule.estimateDate,
      estimateTime: schedule.estimateTime,
      followUpAt: schedule.followUpAt.toISOString(),
    });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: "Could not accept this lead." }, { status: 500 });
  }
}
