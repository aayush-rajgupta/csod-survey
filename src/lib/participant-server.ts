import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { cookies } from "next/headers";

import { createServiceClient } from "@/lib/supabase/service";
import { getActiveQuestions } from "@/lib/survey-data";

const sessionCookie = "csod_participant_session";
const verificationLifetimeMs = 30 * 60 * 1000;
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function appUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL;
  if (!value) throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  return value.replace(/\/$/u, "");
}

async function requestIp(): Promise<string> {
  const requestHeaders = await headers();
  return requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error(
      "Email verification is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
    );
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Verify your CSOD Survey email",
      html: `<p>Verify your CSOD Survey email to continue.</p><p><a href="${appUrl()}/api/participant/verify?token=${encodeURIComponent(token)}">Verify my email</a></p><p>This link expires in 30 minutes and can be used once.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error("The verification email could not be sent.");
  }
}

export async function requestParticipantVerification(input: {
  email: string;
  cityId: string;
}): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error("Enter a valid email address.");
  }

  const supabase = createServiceClient();
  const ip = await requestIp();
  const [emailLimit, ipLimit] = await Promise.all([
    supabase.rpc("consume_participant_verification_rate_limit", {
      p_key: `email:${email}`,
      p_limit: 3,
      p_window_seconds: 900,
    }),
    supabase.rpc("consume_participant_verification_rate_limit", {
      p_key: `ip:${ip}`,
      p_limit: 10,
      p_window_seconds: 900,
    }),
  ]);
  if (emailLimit.error || ipLimit.error) {
    throw new Error("Verification is temporarily unavailable.");
  }
  if (emailLimit.data !== true || ipLimit.data !== true) {
    return { ok: true };
  }

  const { data: city, error: cityError } = await supabase
    .from("cities")
    .select("id")
    .eq("id", input.cityId)
    .eq("is_active", true)
    .maybeSingle();
  if (cityError || !city) throw new Error("Selected city is unavailable.");

  const { data: existing, error: participantError } = await supabase
    .from("participants")
    .select("id, city_id, email_verified")
    .eq("email", email)
    .maybeSingle();
  if (participantError) throw new Error("Unable to start email verification.");
  if (existing && existing.city_id !== input.cityId) {
    return { ok: true };
  }

  let participantId = existing?.id;
  let createdParticipant = false;
  if (!participantId) {
    const { data: publicId, error: allocationError } = await supabase.rpc(
      "next_participant_id",
      { p_city_id: input.cityId },
    );
    if (allocationError || typeof publicId !== "string") {
      throw new Error("Unable to allocate a participant ID.");
    }
    const { data: participant, error: insertError } = await supabase
      .from("participants")
      .insert({
        public_participant_id: publicId,
        email,
        city_id: input.cityId,
      })
      .select("id")
      .single();
    if (insertError || !participant) throw new Error("Unable to create participant.");
    participantId = participant.id;
    createdParticipant = true;
  }

  const rawToken = randomBytes(32).toString("base64url");
  const { error: tokenError } = await supabase
    .from("participant_verification_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("participant_id", participantId)
    .is("used_at", null);
  if (tokenError) throw new Error("Unable to prepare email verification.");

  const { error: insertTokenError } = await supabase
    .from("participant_verification_tokens")
    .insert({
      participant_id: participantId,
      token_hash: hashSecret(rawToken),
      expires_at: new Date(Date.now() + verificationLifetimeMs).toISOString(),
    });
  if (insertTokenError) throw new Error("Unable to prepare email verification.");

  try {
    await sendVerificationEmail(email, rawToken);
  } catch (error) {
    const { error: tokenCleanupError } = await supabase
      .from("participant_verification_tokens")
      .delete()
      .eq("token_hash", hashSecret(rawToken));
    let participantCleanupError: { message: string } | null = null;
    if (createdParticipant) {
      const cleanup = await supabase
        .from("participants")
        .delete()
        .eq("id", participantId);
      participantCleanupError = cleanup.error;
    }
    if (tokenCleanupError || participantCleanupError) {
      throw new Error("Verification is temporarily unavailable.");
    }
    throw error;
  }
  return { ok: true };
}

export async function verifyParticipantToken(rawToken: string): Promise<string> {
  if (!rawToken) throw new Error("Verification link is invalid.");
  const rawSession = randomBytes(32).toString("base64url");
  const supabase = createServiceClient();
  const { data: participantId, error: verificationError } = await supabase.rpc(
    "consume_participant_verification_token",
    {
      p_token_hash: hashSecret(rawToken),
      p_session_token_hash: hashSecret(rawSession),
      p_session_expires_at: new Date(
        Date.now() + sessionLifetimeSeconds * 1000,
      ).toISOString(),
    },
  );
  if (verificationError || !participantId) {
    throw new Error("This verification link is invalid or expired.");
  }

  const cookieStore = await cookies();
  cookieStore.set(sessionCookie, rawSession, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
  return participantId as string;
}

export async function getVerifiedParticipantId(): Promise<string | null> {
  const cookieStore = await cookies();
  const rawSession = cookieStore.get(sessionCookie)?.value;
  if (!rawSession) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("participant_sessions")
    .select("participant_id")
    .eq("session_token_hash", hashSecret(rawSession))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!data) {
    return null;
  }
  const { data: participant } = await supabase
    .from("participants")
    .select("email_verified, email_verified_at")
    .eq("id", data.participant_id)
    .maybeSingle();
  if (!participant?.email_verified || !participant.email_verified_at) return null;
  return data.participant_id;
}

export async function submitParticipantSurvey(input: {
  cityId: string;
  zoneId: string;
  answers: Array<{ question_id: string; answer: unknown }>;
  publicDisplay: boolean;
  futureCommunication: boolean;
}) {
  const participantId = await getVerifiedParticipantId();
  if (!participantId) throw new Error("Verify your email before submitting.");

  const questions = await getActiveQuestions(input.cityId);
  if (!questions.length || new Set(questions.map((question) => question.survey_version)).size !== 1) {
    throw new Error("The active questionnaire is unavailable.");
  }
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const submittedIds = new Set(input.answers.map((answer) => answer.question_id));
  if (questions.some((question) => question.is_required && !submittedIds.has(question.id))) {
    throw new Error("Please answer every required question.");
  }
  if (input.answers.some((answer) => !questionMap.has(answer.question_id))) {
    throw new Error("One or more answers are not part of the active questionnaire.");
  }
  for (const submitted of input.answers) {
    const question = questionMap.get(submitted.question_id);
    if (!question) continue;
    const value = String(submitted.answer ?? "").trim();
    const rules = question.validation_rules;
    if (!value && question.is_required) {
      throw new Error("Please answer every required question.");
    }
    if (question.options.length && value && !question.options.map(String).includes(value)) {
      throw new Error("One or more answers are not valid for the active questionnaire.");
    }
    if (question.question_type === "number" && value && Number.isNaN(Number(value))) {
      throw new Error("A numeric answer is required for one of the questions.");
    }
    const minLength = typeof rules.min_length === "number" ? rules.min_length : undefined;
    const maxLength = typeof rules.max_length === "number" ? rules.max_length : undefined;
    const min = typeof rules.min === "number" ? rules.min : undefined;
    const max = typeof rules.max === "number" ? rules.max : undefined;
    if (minLength !== undefined && value.length < minLength) {
      throw new Error("One or more answers are shorter than allowed.");
    }
    if (maxLength !== undefined && value.length > maxLength) {
      throw new Error("One or more answers are longer than allowed.");
    }
    if (min !== undefined && Number(value) < min) {
      throw new Error("One or more answers are below the allowed range.");
    }
    if (max !== undefined && Number(value) > max) {
      throw new Error("One or more answers are above the allowed range.");
    }
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("submit_participant_survey", {
    p_participant_id: participantId,
    p_city_id: input.cityId,
    p_zone_id: input.zoneId,
    p_answers: input.answers,
    p_public_display: input.publicDisplay,
    p_future_communication: input.futureCommunication,
  });
  if (error || !data?.[0]) throw new Error(error?.message ?? "Unable to submit the survey.");
  return data[0] as {
    submission_id: string;
    public_participant_id: string;
    submission_number: number;
    survey_version: string;
  };
}
