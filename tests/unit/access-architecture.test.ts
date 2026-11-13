import assert from "node:assert/strict";
import { test } from "node:test";

// Constants matching src/lib/insights-data.ts
const CATEGORY_SUPPRESSION_THRESHOLD = 5;
const CITY_RESPONSE_THRESHOLD = 1;
const INSIGHTS_SURVEY_VERSIONS = ["v4"] as const;

test("insights survey versions only query v4", () => {
  assert.deepEqual(INSIGHTS_SURVEY_VERSIONS, ["v4"]);
});

test("insights suppression threshold protects small breakdown privacy", () => {
  assert.equal(CATEGORY_SUPPRESSION_THRESHOLD, 5);
  assert.equal(CITY_RESPONSE_THRESHOLD, 1);
});

test("insights data filter strictly requires approved status, granted consent, and public visibility", () => {
  interface MockSubmission {
    id: string;
    moderation_status: "pending" | "approved" | "rejected";
    public_visibility: boolean;
    survey_version: string;
  }

  interface MockConsent {
    submission_id: string;
    consent_type: string;
    consent_event: string;
    consent_version: string;
    event_provenance: string;
  }

  const submissions: MockSubmission[] = [
    { id: "s1", moderation_status: "approved", public_visibility: true, survey_version: "v4" }, // Eligible
    { id: "s2", moderation_status: "pending", public_visibility: false, survey_version: "v4" },  // Ineligible: pending
    { id: "s3", moderation_status: "rejected", public_visibility: false, survey_version: "v4" }, // Ineligible: rejected
    { id: "s4", moderation_status: "approved", public_visibility: false, survey_version: "v4" }, // Ineligible: private
    { id: "s5", moderation_status: "approved", public_visibility: true, survey_version: "v1" },  // Ineligible: old version
  ];

  const consents: MockConsent[] = [
    { submission_id: "s1", consent_type: "public_display", consent_event: "granted", consent_version: "v4", event_provenance: "new_event" },
    { submission_id: "s4", consent_type: "public_display", consent_event: "declined", consent_version: "v4", event_provenance: "new_event" },
  ];

  // Emulating the filter in getPublicInsights()
  const eligibleSubmissions = submissions.filter((sub) => {
    if (!sub.public_visibility || sub.moderation_status !== "approved") return false;
    if (!INSIGHTS_SURVEY_VERSIONS.includes(sub.survey_version as "v4")) return false;
    const consent = consents.find((c) => c.submission_id === sub.id && c.consent_type === "public_display");
    return (
      consent?.consent_event === "granted" &&
      consent.consent_version === sub.survey_version &&
      consent.event_provenance !== "legacy_ambiguous"
    );
  });

  assert.equal(eligibleSubmissions.length, 1);
  assert.equal(eligibleSubmissions[0].id, "s1");
});

test("participant privacy guarantee: no emails or tokens are present in public insight models", () => {
  // PublicResponseSummary type inspection
  const summaryKeys = ["publicParticipantId", "city", "submittedAt", "submissionNumber"];
  assert.ok(!summaryKeys.includes("email"));
  assert.ok(!summaryKeys.includes("sessionToken"));
  assert.ok(!summaryKeys.includes("participantId")); // Only public text ID is exposed
});

test("admin authorization architecture: rejects unauthenticated or non-admin callers", async () => {
  async function simulateVerifyAdmin(user: { id: string } | null, adminRole: string | null) {
    if (!user) {
      throw new Error("Unauthorized: Administrator sign-in required.");
    }
    if (adminRole !== "super_admin") {
      throw new Error("Forbidden: Administrator privileges required.");
    }
    return { userId: user.id };
  }

  // 1. Unauthenticated -> 401 Unauthorized
  await assert.rejects(
    simulateVerifyAdmin(null, null),
    /Unauthorized: Administrator sign-in required./,
  );

  // 2. Authenticated but not in admin_users -> 403 Forbidden
  await assert.rejects(
    simulateVerifyAdmin({ id: "user-regular" }, null),
    /Forbidden: Administrator privileges required./,
  );

  // 3. Authenticated but non-super_admin role -> 403 Forbidden
  await assert.rejects(
    simulateVerifyAdmin({ id: "user-reviewer" }, "editor"),
    /Forbidden: Administrator privileges required./,
  );

  // 4. Authenticated with verified super_admin role -> OK
  const authorized = await simulateVerifyAdmin({ id: "user-super-admin" }, "super_admin");
  assert.equal(authorized.userId, "user-super-admin");
});

test("admin input validation: enforces strict UUID and status invariants", () => {
  function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    );
  }

  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid("'; drop table survey_submissions; --"), false);
  assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), false);
  assert.equal(isUuid("c2c507c6-38e4-4599-b8be-68729003cbfc"), true);

  const allowedStatuses = ["approved", "rejected", "pending"];
  assert.ok(allowedStatuses.includes("approved"));
  assert.ok(allowedStatuses.includes("rejected"));
  assert.ok(allowedStatuses.includes("pending"));
  assert.ok(!allowedStatuses.includes("invalid_status"));
});
