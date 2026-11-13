import assert from "node:assert/strict";
import { test } from "node:test";

import {
  escapeHtml,
  generateSubmissionNotificationContent,
} from "../../src/lib/email-notifications";

test("escapeHtml prevents HTML injection in participant answers", () => {
  const dangerous = `<script>alert("xss")</script>&'hello"`;
  const escaped = escapeHtml(dangerous);
  assert.equal(
    escaped,
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&amp;&#39;hello&quot;",
  );
  assert.ok(!escaped.includes("<script>"));
});

test("generateSubmissionNotificationContent includes all required fields", () => {
  const content = generateSubmissionNotificationContent({
    submissionId: "b8a97441-3d71-4a11-8ec2-132d718a9001",
    publicParticipantId: "BBSR-0042",
    email: "citizen@example.com",
    cityName: "Bhubaneswar",
    zoneName: "North Zone",
    submittedAt: "Friday, November 14, 2026 at 12:00:00 AM UTC",
    submissionNumber: 1,
    surveyVersion: "v4",
    researchConsent: true,
    publicDisplayConsent: true,
    futureCommunicationConsent: false,
    answers: [
      {
        questionKey: "perceived_air_quality",
        questionText: "How would you rate air quality in your area?",
        answer: "3",
      },
      {
        questionKey: "observed_pollution_sources",
        questionText: "Which sources of pollution do you notice?",
        answer: ["Vehicle exhaust", "Construction dust"],
      },
      {
        questionKey: "free_text_feedback",
        questionText: "Any additional observations?",
        answer: "Heavy smoke near industrial area <danger & test>.",
      },
    ],
    dailyActivities: [
      {
        sequence: 1,
        startTime: "06:00",
        endTime: "08:00",
        durationMinutes: 120,
        activityCategory: "Walking / Exercising",
        locationCategory: "Outdoor public space / Park",
      },
      {
        sequence: 2,
        startTime: "20:00",
        endTime: "06:00",
        durationMinutes: 600,
        activityCategory: "Sleeping / Resting",
        locationCategory: "Home",
      },
    ],
  });

  // Verify Subject
  assert.equal(
    content.subject,
    "New CSOD Survey Submission — BBSR-0042 — Bhubaneswar",
  );

  // Verify HTML contains participant details
  assert.ok(content.html.includes("BBSR-0042"));
  assert.ok(content.html.includes("citizen@example.com"));
  assert.ok(content.html.includes("Bhubaneswar"));
  assert.ok(content.html.includes("North Zone"));
  assert.ok(content.html.includes("#1"));
  assert.ok(content.html.includes("v4"));

  // Verify separate consent dimensions
  assert.ok(content.html.includes("Research Participation"));
  assert.ok(content.html.includes("Public Display"));
  assert.ok(content.html.includes("Future Communication"));
  assert.ok(content.text.includes("Research Participation : Granted"));
  assert.ok(content.text.includes("Public Display         : Granted"));
  assert.ok(content.text.includes("Future Communication   : Declined"));

  // Verify daily schedule table and overnight label
  assert.ok(content.html.includes("Walking / Exercising"));
  assert.ok(content.html.includes("Outdoor public space / Park"));
  assert.ok(content.html.includes("2 hours"));
  assert.ok(content.html.includes("10 hours"));
  assert.ok(content.html.includes("Next day"), "Overnight schedule must show Next day indicator");
  assert.ok(content.text.includes("(next day)"));

  // Verify free-text answer and HTML escaping
  assert.ok(content.html.includes("Heavy smoke near industrial area &lt;danger &amp; test&gt;."));
  assert.ok(!content.html.includes("<danger & test>"));

  // Verify plain text contains all sections
  assert.ok(content.text.includes("--- PARTICIPANT DETAILS ---"));
  assert.ok(content.text.includes("--- CONSENT STATUS ---"));
  assert.ok(content.text.includes("--- DAILY ACTIVITY SCHEDULE ---"));
  assert.ok(content.text.includes("--- SURVEY RESPONSES ---"));
});

test("idempotency key format is deterministic based on submission ID", () => {
  const submissionId = "b8a97441-3d71-4a11-8ec2-132d718a9001";
  const idempotencyKey = `csod-submission-notification/${submissionId}`;
  assert.equal(
    idempotencyKey,
    "csod-submission-notification/b8a97441-3d71-4a11-8ec2-132d718a9001",
  );
});

