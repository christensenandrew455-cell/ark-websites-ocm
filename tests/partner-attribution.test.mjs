import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizePartnerCode,
  partnerAccountFields,
  resolveSignupAttribution,
} from "../app/lib/partnerAttribution.js";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function partnerDb(partners = {}) {
  return {
    collection(root) {
      assert.equal(root, "system");
      return {
        doc(documentId) {
          assert.equal(documentId, "global");
          return {
            collection(name) {
              assert.equal(name, "partnerCodes");
              return {
                doc(code) {
                  return {
                    async get() {
                      const data = partners[code];
                      return { exists: data !== undefined, data: () => data };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("active partner codes are separate from customer referrals", async () => {
  const attribution = await resolveSignupAttribution({
    db: partnerDb({
      t1223: {
        partnerName: "Tabor Marketing",
        codeDisplay: "T1223",
        commissionBasisPoints: 2_000,
        active: true,
      },
    }),
    code: " T1 223 ",
  });

  assert.equal(normalizePartnerCode(" T1 223 "), "t1-223");
  assert.deepEqual(attribution, { type: "referral", referralCode: "t1-223" });

  const partner = await resolveSignupAttribution({ db: partnerDb({ t1223: {
    partnerName: "Tabor Marketing",
    codeDisplay: "T1223",
    commissionBasisPoints: 2_000,
    active: true,
  } }), code: "t1223" });
  assert.equal(partner.type, "partner");
  assert.equal(partner.partnerCode, "t1223");
  assert.equal(partner.partnerCommissionBasisPoints, 2_000);
  assert.deepEqual(partnerAccountFields(partner), {
    signupAttributionType: "partner",
    partnerCode: "t1223",
    partnerCodeDisplay: "T1223",
    partnerName: "Tabor Marketing",
    partnerCommissionBasisPoints: 2_000,
  });
  assert.equal("referralCode" in partner, false);
});

test("paused partner codes cannot fall through into the free-month referral path", async () => {
  const result = await resolveSignupAttribution({
    db: partnerDb({ t1223: { partnerName: "Tabor Marketing", active: false } }),
    code: "T1223",
  });
  assert.deepEqual(result, { type: "inactive-partner", partnerCode: "t1223" });
  assert.deepEqual(partnerAccountFields(result), {});
});

test("unknown codes keep the existing customer referral behavior", async () => {
  assert.deepEqual(
    await resolveSignupAttribution({ db: partnerDb(), code: "My Existing Business" }),
    { type: "referral", referralCode: "my-existing-business" },
  );
  assert.deepEqual(await resolveSignupAttribution({ db: partnerDb(), code: "" }), { type: "none" });
});

test("signup activation and every revenue path preserve partner attribution", async () => {
  const [stripeSignup, appleSignup, ledger, stripeBilling, topUp, signupPage, availability, adminWebhook] = await Promise.all([
    source("app/lib/ownerPaymentSetup.js"),
    source("app/lib/ownerApplePaymentSetup.js"),
    source("app/lib/revenueLedger.js"),
    source("app/lib/stripePlanBilling.js"),
    source("app/api/billing/top-up/route.js"),
    source("app/signup/page.js"),
    source("app/lib/signupAvailability.js"),
    source("app/api/webhooks/admin/route.js"),
  ]);
  for (const activation of [stripeSignup, appleSignup]) {
    assert.ok(activation.includes("resolveSignupAttribution"));
    assert.ok(activation.includes('signupAttribution.type === "referral"'));
    assert.ok(activation.includes("partnerAccountFields(signupAttribution)"));
  }
  assert.ok(ledger.includes("addSavedPartnerAttribution"));
  assert.ok(ledger.includes("partnerCode: normalized.partnerCode"));
  assert.ok(stripeBilling.includes("partnerCode"));
  assert.ok(topUp.includes("partnerCode"));
  assert.ok(signupPage.includes("Referral or partner code"));
  assert.ok(availability.includes('systemCollection(db, "partnerCodes")'));
  assert.ok(adminWebhook.includes('type) === "system.admin_link.check"'));
  assert.ok(adminWebhook.includes('type: "system.admin_link.probe"'));
});
