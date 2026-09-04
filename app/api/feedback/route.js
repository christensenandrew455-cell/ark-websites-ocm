import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { sendAdminEvent } from "../../lib/adminEvents";
import { requireUser } from "../../lib/userRequest";
import { feedbackSentiment, feedbackTopic } from "../../lib/feedbackOptions";
import { getAdminDb } from "../../lib/firebase-admin";
import { systemCollection } from "../../lib/firestoreLayout";
import { checkRequestRateLimit, rateLimitResponse } from "../../lib/requestRateLimit";
import { TEMPORARY_FEATURES } from "../../lib/temporaryFeatures";
import { trimmedText } from "../../lib/valueUtils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!TEMPORARY_FEATURES.feedback.enabled) {
    return NextResponse.json({ error: "Feedback is not available right now." }, { status: 404 });
  }
  const authorization = await requireUser(request);
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json().catch(() => ({}));
    const sentiment = feedbackSentiment(body.sentiment);
    const topic = feedbackTopic(body.topic);
    const message = trimmedText(body.message);
    if (!sentiment) return NextResponse.json({ error: "Choose whether this is going well, mixed, or needs work." }, { status: 400 });
    if (!topic) return NextResponse.json({ error: "Choose what the feedback is about." }, { status: 400 });
    if (message.length < 10) return NextResponse.json({ error: "Add at least 10 characters so ARK can understand the feedback." }, { status: 400 });
    if (message.length > 2000) return NextResponse.json({ error: "Keep feedback under 2,000 characters." }, { status: 400 });

    const db = getAdminDb();
    const rateLimit = await checkRequestRateLimit({
      db,
      request,
      scope: `feedback:${authorization.clientId}:${authorization.decodedToken.uid}`,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    const accountRef = db.collection("accounts").doc(authorization.clientId);
    const ref = systemCollection(db, "supportRequests").doc();
    const saved = await db.runTransaction(async (transaction) => {
      const accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists) throw new Error("FEEDBACK_ACCOUNT_NOT_FOUND");
      const account = accountSnapshot.data();
      const businessName = trimmedText(account.businessName || authorization.clientId);
      const timestamp = FieldValue.serverTimestamp();
      transaction.create(ref, {
        clientId: authorization.clientId,
        businessName,
        ownerName: trimmedText(account.ownerName || authorization.decodedToken.name),
        accountEmail: trimmedText(account.accountEmail || authorization.decodedToken.email).toLowerCase(),
        contactPhone: trimmedText(account.accountPhone),
        type: "feedback",
        source: "client-center-feedback",
        category: topic.key,
        categoryLabel: topic.label,
        sentiment: sentiment.key,
        sentimentLabel: sentiment.label,
        subject: `${sentiment.shortLabel} feedback · ${topic.label}`,
        message,
        status: "new",
        priority: "normal",
        createdByUid: authorization.decodedToken.uid,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return { businessName };
    });
    await sendAdminEvent({
      id: `feedback-${ref.id}`,
      type: "feedback.created",
      clientId: authorization.clientId,
      businessName: saved.businessName,
      summary: `${sentiment.shortLabel} feedback about ${topic.label}`,
      metadata: {
        requestId: ref.id,
        sentiment: sentiment.key,
        topic: topic.key,
      },
    });
    return NextResponse.json({
      ok: true,
      id: ref.id,
    }, { status: 201 });
  } catch (error) {
    if (String(error?.message || "") === "FEEDBACK_ACCOUNT_NOT_FOUND") {
      return NextResponse.json({ error: "This account could not be found." }, { status: 404 });
    }
    console.error("Unable to save customer feedback", error);
    return NextResponse.json({ error: "Feedback could not be sent. Try again." }, { status: 500 });
  }
}
