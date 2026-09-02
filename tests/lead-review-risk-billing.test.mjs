import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  calculateLeadRisk,
  leadRiskLabel,
  leadRiskLevel,
} from "../app/lib/leadRiskAssessment.js";
import { pendingLeadSummary } from "../app/lib/leadVisibility.js";

function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("lead risk levels use the four requested score ranges", () => {
  assert.equal(leadRiskLevel(0), "low");
  assert.equal(leadRiskLevel(2), "low");
  assert.equal(leadRiskLevel(3), "moderate");
  assert.equal(leadRiskLevel(5), "moderate");
  assert.equal(leadRiskLevel(6), "high");
  assert.equal(leadRiskLevel(8), "high");
  assert.equal(leadRiskLevel(9), "very-high");
  assert.equal(leadRiskLabel("very-high"), "Very high risk");
});

test("normal verified information scores zero", () => {
  const result = calculateLeadRisk({
    riskAssessment: {
      addressVerified: true,
      outsideServiceArea: false,
      phoneLookupStatus: "success",
      phoneLocationMismatch: false,
      phoneIsVoip: false,
      callerNameUnavailable: false,
      callerNameMismatch: false,
      resistanceCount: 1,
    },
  });
  assert.equal(result.assessed, true);
  assert.equal(result.score, 0);
  assert.equal(result.level, "low");
  assert.deepEqual(result.breakdown, []);
});

test("risk facts receive the exact requested points", () => {
  const result = calculateLeadRisk({
    outsideServiceArea: true,
    phoneLookupStatus: "success",
    phoneLocationMismatch: true,
    phoneLineType: "voip",
    callerNameMismatch: true,
    addressVerified: false,
    resistanceCount: 5,
  });
  assert.equal(result.score, 11);
  assert.equal(result.level, "very-high");
  assert.deepEqual(
    Object.fromEntries(result.breakdown.map((item) => [item.key, item.points])),
    {
      "outside-service-area": 1,
      "phone-location-mismatch": 1,
      "voip-phone": 1,
      "caller-name-mismatch": 2,
      "address-unverified": 4,
      "customer-resistance": 2,
    },
  );
});

test("resistance points step up only at two, four, and six occurrences", () => {
  const score = (resistanceCount) => calculateLeadRisk({ resistanceCount }).score;
  assert.equal(score(0), 0);
  assert.equal(score(1), 0);
  assert.equal(score(2), 1);
  assert.equal(score(3), 1);
  assert.equal(score(4), 2);
  assert.equal(score(5), 2);
  assert.equal(score(6), 3);
  assert.equal(score(100), 3);
});

test("a failed phone lookup is four points and does not stack unavailable lookup-only facts", () => {
  const result = calculateLeadRisk({
    phoneLookupFailed: true,
    phoneLocationMismatch: true,
    phoneIsVoip: true,
    callerNameUnavailable: true,
    callerNameMismatch: true,
  });
  assert.equal(result.score, 4);
  assert.deepEqual(result.breakdown.map((item) => item.key), ["phone-lookup-failed"]);
});

test("nested receptionist signal payloads are scored without trusting a supplied total", () => {
  const result = calculateLeadRisk({
    riskAssessment: {
      score: 99,
      signals: {
        addressVerified: true,
        outsideServiceArea: true,
        phoneLookupStatus: "success",
        callerNameUnavailable: true,
      },
    },
  });
  assert.equal(result.score, 2);
  assert.equal(result.level, "low");
});

test("Contacted You summaries exclude private contact fields but show the requested time window", () => {
  const summary = pendingLeadSummary("lead-1", {
    Name: "Jordan Lee",
    Job: "Replace water heater",
    Phone: "+19785550123",
    Address: "1 Main Street",
    ClientNotes: "Private details",
    RequestSummary: "- Service: Replace water heater\n- Address: 1 Main Street",
    requestedDate: "2026-09-02",
    requestedTimeWindow: "Afternoon",
    rawSubmission: { transcript: "private" },
    riskAssessment: calculateLeadRisk({ addressVerified: false, resistanceCount: 2 }),
  });
  assert.deepEqual(Object.keys(summary).sort(), [
    "Job",
    "Name",
    "PreferredDay",
    "PreferredTimeWindow",
    "collectionKey",
    "contactedAt",
    "createdAt",
    "id",
    "riskAssessed",
    "riskLevel",
    "riskScore",
    "updatedAt",
  ]);
  assert.equal(Object.hasOwn(summary, "Phone"), false);
  assert.equal(Object.hasOwn(summary, "Address"), false);
  assert.equal(Object.hasOwn(summary, "RequestSummary"), false);
  assert.equal(summary.PreferredDay, "2026-09-02");
  assert.equal(summary.PreferredTimeWindow, "Afternoon");
  assert.equal(summary.riskScore, 5);
  assert.equal(summary.riskLevel, "moderate");
});

test("legacy leads are not described as low risk when no check was supplied", () => {
  const summary = pendingLeadSummary("legacy-lead", {
    Name: "Legacy Lead",
    Job: "Estimate",
    riskAssessment: calculateLeadRisk({}),
  });
  assert.equal(summary.riskAssessed, false);
  assert.equal(summary.riskScore, 0);
});

test("only accepted leads consume the plan and repeated acceptance is idempotent", async () => {
  const [intake, acceptance, completedCalls, component, leadRoute] = await Promise.all([
    source("app/api/intake/route.js"),
    source("app/api/business/leads/accept/route.js"),
    source("app/api/receptionist/calls/route.js"),
    source("app/components/ReviewClientsNative.js"),
    source("app/api/business/leads/route.js"),
  ]);
  assert.ok(intake.includes('const sectionKey = "contactedMe"'));
  assert.equal(intake.includes("recordLeadUsage"), false);
  assert.equal(intake.includes("addBillingLeadEventToBatch"), false);
  assert.ok(acceptance.includes("acceptedLeadEventRef"));
  assert.ok(acceptance.includes("acceptedLeadAccountPatch"));
  assert.ok(acceptance.includes("transaction.create(eventRef"));
  assert.ok(acceptance.includes('code: "MONTHLY_ACCEPTED_LEAD_LIMIT_REACHED"'));
  assert.ok(completedCalls.includes("recordCompletedCall"));
  assert.equal(completedCalls.includes("callsRemaining"), false);
  assert.ok(completedCalls.includes("acceptedLeadsRemaining"));
  assert.ok(component.includes('"Accept"'));
  assert.ok(component.includes('>Decline</button>'));
  assert.ok(component.includes("Requested service window"));
  assert.ok(component.includes("Requested: {schedule}"));
  assert.ok(intake.includes("data.RequestSummary || data.requestSummary || data.serviceRequestSummary"));
  assert.ok(intake.includes("RequestSummary,"));
  assert.ok(intake.includes("PreferredTimeWindow,"));
  assert.ok(component.includes("RequestSummary: firstValue(data.RequestSummary, data.requestSummary, data.serviceRequestSummary)"));
  assert.ok(component.includes("PreferredTimeWindow: firstValue"));
  assert.equal(component.includes("EstimateDate: firstValue(data.EstimateDate, data.estimateDate, data.PreferredDate"), false);
  assert.ok(component.includes("if (!normalizedTime) return null;"));
  assert.equal(leadRoute.includes("PreferredDate: text(fields.EstimateDate"), false);
  assert.equal(leadRoute.includes("PreferredTime: text(fields.EstimateTime"), false);
  assert.ok(component.includes("Service request summary"));
  assert.ok(component.includes("requestSummary.map((item)"));
  assert.equal(component.includes("charged"), false);
});

test("pending lead details cannot be recovered through another owner-facing path", async () => {
  const [leadApi, exportApi, messagingApi, declineApi, rules] = await Promise.all([
    source("app/api/business/leads/route.js"),
    source("app/api/account/export/route.js"),
    source("app/api/business/lead-messages/route.js"),
    source("app/api/business/leads/client-decline-notice/route.js"),
    source("firestore.rules"),
  ]);
  assert.ok(leadApi.includes("pendingLeadSummary(document.id, data)"));
  assert.ok(exportApi.includes('leadDocuments(contactedSnapshot, "contactedMe")'));
  assert.ok(exportApi.includes("pendingLeadSummary(document.id, data)"));
  assert.ok(messagingApi.includes('collection("clients").doc(text(leadId))'));
  assert.equal(messagingApi.includes('const collections = ["contactedMe", "clients"]'), false);
  assert.ok(declineApi.includes('root.collection("contactedMe").doc(leadId).get()'));
  assert.ok(declineApi.includes("phone: text(lead.Phone"));
  assert.ok(rules.includes("allow read, write: if false"));
});
