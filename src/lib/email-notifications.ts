import "server-only";

import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/service";
import {
  formatActivityDuration,
  formatTime12Hour,
  isOvernightActivity,
} from "@/lib/daily-activity";

export type SubmissionEmailNotificationRow = {
  id: string;
  submission_id: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempt_count: number;
  provider_email_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  sending_started_at: string | null;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAnswerValue(answer: unknown): string {
  if (answer === null || answer === undefined) return "—";
  if (Array.isArray(answer)) {
    return answer.map((item) => String(item)).join(", ");
  }
  if (typeof answer === "object") {
    return JSON.stringify(answer);
  }
  return String(answer);
}

export function generateSubmissionNotificationContent(data: {
  submissionId: string;
  publicParticipantId: string;
  email: string;
  cityName: string;
  zoneName: string;
  submittedAt: string;
  submissionNumber: number;
  surveyVersion: string;
  researchConsent: boolean;
  publicDisplayConsent: boolean;
  futureCommunicationConsent: boolean;
  answers: Array<{
    questionKey: string;
    questionText: string;
    answer: unknown;
  }>;
  dailyActivities: Array<{
    sequence: number;
    startTime: string;
    endTime: string;
    durationMinutes: number;
    activityCategory: string;
    activityOther?: string | null;
    locationCategory: string;
    locationOther?: string | null;
  }>;
}): { subject: string; html: string; text: string } {
  const subject = `New CSOD Survey Submission — ${data.publicParticipantId} — ${data.cityName}`;

  const textLines: string[] = [
    "============================================================",
    `CSOD SURVEY SUBMISSION NOTIFICATION`,
    "============================================================",
    "",
    "--- PARTICIPANT DETAILS ---",
    `Public Participant ID : ${data.publicParticipantId}`,
    `Participant Email     : ${data.email}`,
    `City                  : ${data.cityName}`,
    `Zone                  : ${data.zoneName}`,
    `Submission Date/Time  : ${data.submittedAt}`,
    `Submission Number     : #${data.submissionNumber}`,
    `Survey Version        : ${data.surveyVersion}`,
    "",
    "--- CONSENT STATUS ---",
    `Research Participation : ${data.researchConsent ? "Granted" : "Declined"}`,
    `Public Display         : ${data.publicDisplayConsent ? "Granted" : "Declined"}`,
    `Future Communication   : ${data.futureCommunicationConsent ? "Granted" : "Declined"}`,
    "",
    "--- DAILY ACTIVITY SCHEDULE ---",
    "| Start    | End      | Duration  | Activity                     | Location                     |",
    "|----------|----------|-----------|------------------------------|------------------------------|",
  ];

  for (const item of data.dailyActivities) {
    const isOvernight = isOvernightActivity(item.startTime, item.endTime);
    const startStr = formatTime12Hour(item.startTime);
    const endStr = `${formatTime12Hour(item.endTime)}${isOvernight ? " (next day)" : ""}`;
    const durStr = formatActivityDuration(item.durationMinutes);
    const actStr = item.activityOther
      ? `${item.activityCategory} (${item.activityOther})`
      : item.activityCategory;
    const locStr = item.locationOther
      ? `${item.locationCategory} (${item.locationOther})`
      : item.locationCategory;

    textLines.push(
      `| ${startStr.padEnd(8)} | ${endStr.padEnd(8)} | ${durStr.padEnd(9)} | ${actStr.padEnd(28)} | ${locStr.padEnd(28)} |`,
    );
  }

  textLines.push("", "--- SURVEY RESPONSES ---");
  for (const ans of data.answers) {
    textLines.push(`[${ans.questionKey}] ${ans.questionText}`);
    textLines.push(`Answer: ${formatAnswerValue(ans.answer)}`);
    textLines.push("");
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.5; color: #1e293b; background-color: #f8fafc; margin: 0; padding: 24px; }
    .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; max-width: 680px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { border-bottom: 2px solid #059669; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 700; color: #065f46; margin: 0; }
    .subtitle { font-size: 13px; color: #64748b; margin-top: 4px; }
    h2 { font-size: 15px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em; margin: 24px 0 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; background-color: #f8fafc; color: #475569; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; }
    .badge-green { background-color: #d1fae5; color: #065f46; }
    .badge-gray { background-color: #f1f5f9; color: #475569; }
    .badge-amber { background-color: #fef3c7; color: #92400e; }
    .question-row { margin-bottom: 12px; padding: 10px 12px; background-color: #f8fafc; border-radius: 8px; font-size: 13px; }
    .question-text { font-weight: 600; color: #334155; margin-bottom: 4px; }
    .answer-text { color: #0f172a; white-space: pre-wrap; word-break: break-word; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="title">CSOD Survey Submission</div>
      <div class="subtitle">A new survey response has been successfully recorded.</div>
    </div>

    <h2>Participant Details</h2>
    <table>
      <tr>
        <th style="width: 35%;">Public Participant ID</th>
        <td><strong style="color: #059669;">${escapeHtml(data.publicParticipantId)}</strong></td>
      </tr>
      <tr>
        <th>Participant Email</th>
        <td>${escapeHtml(data.email)}</td>
      </tr>
      <tr>
        <th>City</th>
        <td>${escapeHtml(data.cityName)}</td>
      </tr>
      <tr>
        <th>Zone</th>
        <td>${escapeHtml(data.zoneName)}</td>
      </tr>
      <tr>
        <th>Submission Time</th>
        <td>${escapeHtml(data.submittedAt)}</td>
      </tr>
      <tr>
        <th>Submission Number</th>
        <td>#${data.submissionNumber}</td>
      </tr>
      <tr>
        <th>Survey Version</th>
        <td>${escapeHtml(data.surveyVersion)}</td>
      </tr>
    </table>

    <h2>Consent Choices</h2>
    <table>
      <tr>
        <th style="width: 50%;">Research Participation</th>
        <td>
          <span class="badge ${data.researchConsent ? "badge-green" : "badge-gray"}">
            ${data.researchConsent ? "Granted" : "Declined"}
          </span>
        </td>
      </tr>
      <tr>
        <th>Public Display</th>
        <td>
          <span class="badge ${data.publicDisplayConsent ? "badge-green" : "badge-gray"}">
            ${data.publicDisplayConsent ? "Granted" : "Declined"}
          </span>
        </td>
      </tr>
      <tr>
        <th>Future Communication</th>
        <td>
          <span class="badge ${data.futureCommunicationConsent ? "badge-green" : "badge-gray"}">
            ${data.futureCommunicationConsent ? "Granted" : "Declined"}
          </span>
        </td>
      </tr>
    </table>

    <h2>Daily Activity Schedule</h2>
    <table>
      <thead>
        <tr>
          <th>Start</th>
          <th>End</th>
          <th>Duration</th>
          <th>Activity</th>
          <th>Location</th>
        </tr>
      </thead>
      <tbody>
        ${data.dailyActivities
          .map((item) => {
            const isOvernight = isOvernightActivity(item.startTime, item.endTime);
            const actLabel = item.activityOther
              ? `${item.activityCategory} (${item.activityOther})`
              : item.activityCategory;
            const locLabel = item.locationOther
              ? `${item.locationCategory} (${item.locationOther})`
              : item.locationCategory;

            return `<tr>
              <td>${escapeHtml(formatTime12Hour(item.startTime))}</td>
              <td>
                ${escapeHtml(formatTime12Hour(item.endTime))}
                ${isOvernight ? `<span class="badge badge-amber" style="margin-left: 4px;">Next day</span>` : ""}
              </td>
              <td>${escapeHtml(formatActivityDuration(item.durationMinutes))}</td>
              <td>${escapeHtml(actLabel)}</td>
              <td>${escapeHtml(locLabel)}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>

    <h2>Survey Responses</h2>
    <div>
      ${data.answers
        .map(
          (ans) => `<div class="question-row">
            <div class="question-text">${escapeHtml(ans.questionText)}</div>
            <div class="answer-text">${escapeHtml(formatAnswerValue(ans.answer))}</div>
          </div>`,
        )
        .join("")}
    </div>

    <div class="footer">
      This is an automated administrative notification from the CSOD Survey platform.<br />
      Internal submission reference: ${escapeHtml(data.submissionId)}
    </div>
  </div>
</body>
</html>`;

  return { subject, html, text: textLines.join("\n") };
}

export async function sendSubmissionNotification(
  submissionId: string,
  options?: { forceRetry?: boolean },
): Promise<{ ok: boolean; status: "sent" | "failed" | "skipped"; error?: string }> {
  const supabase = createServiceClient();

  // 1. Atomically claim the notification row
  let claimQuery = supabase
    .from("submission_email_notifications")
    .update({
      status: "sending",
      sending_started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("submission_id", submissionId);

  if (!options?.forceRetry) {
    claimQuery = claimQuery.in("status", ["pending", "failed"]);
  }

  const { data: claimed, error: claimError } = await claimQuery
    .select("id, submission_id, status, attempt_count")
    .maybeSingle();

  if (claimError || !claimed) {
    // If not claimed, it could already be sent or actively sending
    return { ok: true, status: "skipped" };
  }

  // Update attempt count
  await supabase
    .from("submission_email_notifications")
    .update({
      attempt_count: (claimed.attempt_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", claimed.id);

  // 2. Validate configuration
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const adminEmail = process.env.CSOD_SUBMISSION_NOTIFICATION_EMAIL;

  if (!apiKey || !fromEmail || !adminEmail) {
    const errorMsg =
      "Missing email configuration: RESEND_API_KEY, RESEND_FROM_EMAIL, or CSOD_SUBMISSION_NOTIFICATION_EMAIL is unset.";
    console.warn(`[email-notifications] ${errorMsg}`);
    await supabase
      .from("submission_email_notifications")
      .update({
        status: "failed",
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimed.id);
    return { ok: false, status: "failed", error: errorMsg };
  }

  try {
    // 3. Fetch submission details
    const { data: submission, error: subError } = await supabase
      .from("survey_submissions")
      .select("id, participant_id, city_id, zone_id, submission_number, survey_version, created_at")
      .eq("id", submissionId)
      .maybeSingle();

    if (subError || !submission) {
      throw new Error(`Submission not found: ${submissionId}`);
    }

    const [
      { data: participant },
      { data: city },
      { data: zone },
      { data: answers },
      { data: questions },
      { data: dailyActivities },
      { data: consentRows },
    ] = await Promise.all([
      supabase
        .from("participants")
        .select("id, public_participant_id, email")
        .eq("id", submission.participant_id)
        .single(),
      supabase
        .from("cities")
        .select("id, name")
        .eq("id", submission.city_id)
        .single(),
      supabase
        .from("city_zones")
        .select("id, zone_name")
        .eq("id", submission.zone_id)
        .single(),
      supabase
        .from("survey_answers")
        .select("question_id, answer")
        .eq("submission_id", submissionId),
      supabase
        .from("survey_questions")
        .select("id, question_key, question_text, display_order")
        .eq("survey_version", submission.survey_version)
        .order("display_order", { ascending: true }),
      supabase
        .from("daily_activity_entries")
        .select("sequence, start_time, end_time, location_category, location_other, activity_category, activity_other, duration_minutes")
        .eq("submission_id", submissionId)
        .order("sequence", { ascending: true }),
      supabase
        .from("consent_records")
        .select("consent_type, consent_event, event_sequence")
        .eq("submission_id", submissionId)
        .order("event_sequence", { ascending: false }),
    ]);

    const questionMap = new Map((questions ?? []).map((q) => [q.id, q]));
    const formattedAnswers = (answers ?? []).map((ans) => {
      const q = questionMap.get(ans.question_id);
      return {
        questionKey: q?.question_key ?? "unknown",
        questionText: q?.question_text ?? ans.question_id,
        answer: ans.answer,
      };
    });

    const latestConsentByType = new Map<string, string>();
    for (const c of consentRows ?? []) {
      if (!latestConsentByType.has(c.consent_type)) {
        latestConsentByType.set(c.consent_type, c.consent_event);
      }
    }

    const { subject, html, text } = generateSubmissionNotificationContent({
      submissionId,
      publicParticipantId: participant?.public_participant_id ?? "unknown",
      email: participant?.email ?? "unknown",
      cityName: city?.name ?? "Unknown City",
      zoneName: zone?.zone_name ?? "Unknown Zone",
      submittedAt: new Date(submission.created_at).toLocaleString("en-US", {
        timeZone: "UTC",
        dateStyle: "full",
        timeStyle: "long",
      }),
      submissionNumber: submission.submission_number,
      surveyVersion: submission.survey_version,
      researchConsent: latestConsentByType.get("research_participation") === "granted",
      publicDisplayConsent: latestConsentByType.get("public_display") === "granted",
      futureCommunicationConsent:
        latestConsentByType.get("future_communication") === "granted",
      answers: formattedAnswers,
      dailyActivities: (dailyActivities ?? []).map((item) => ({
        sequence: item.sequence,
        startTime: item.start_time,
        endTime: item.end_time,
        durationMinutes: item.duration_minutes,
        activityCategory: item.activity_category,
        activityOther: item.activity_other,
        locationCategory: item.location_category,
        locationOther: item.location_other,
      })),
    });

    // 4. Send via Resend with Idempotency Key
    const resend = new Resend(apiKey);
    const idempotencyKey = `csod-submission-notification/${submissionId}`;

    const sendResponse = await resend.emails.send(
      {
        from: fromEmail,
        to: adminEmail,
        subject,
        html,
        text,
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
      {
        headers: {
          "Idempotency-Key": idempotencyKey,
        },
      },
    );

    if (sendResponse.error) {
      throw new Error(sendResponse.error.message || "Failed to send email via Resend");
    }

    const providerEmailId = sendResponse.data?.id ?? null;

    // 5. Update outbox to sent
    await supabase
      .from("submission_email_notifications")
      .update({
        status: "sent",
        provider_email_id: providerEmailId,
        last_error: null,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimed.id);

    console.info(`[email-notifications] Sent submission notification ${submissionId} (id: ${providerEmailId})`);
    return { ok: true, status: "sent" };
  } catch (sendError) {
    const errorMsg =
      sendError instanceof Error
        ? sendError.message.slice(0, 500)
        : "Unknown sending error";
    console.error(`[email-notifications] Failed to send submission notification ${submissionId}:`, errorMsg);

    await supabase
      .from("submission_email_notifications")
      .update({
        status: "failed",
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", claimed.id);

    return { ok: false, status: "failed", error: errorMsg };
  }
}

