import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { createServiceClient } from "@/lib/supabase/service";
import { getActiveQuestions } from "@/lib/survey-data";

const sessionCookie = "csod_participant_session";
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function sanitizedDatabaseError(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): { code: string; message: string; details?: string; hint?: string } {
  const redact = (value: string | undefined) =>
    value
      ?.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, "[redacted-email]")
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
        "[redacted-uuid]",
      )
      .replace(/\b[A-Za-z0-9_-]{32,}\b/gu, "[redacted-token]")
      .slice(0, 240);
  return {
    code: error.code ?? "unknown",
    message: redact(error.message) ?? "unknown database error",
    ...(error.details ? { details: redact(error.details) } : {}),
    ...(error.hint ? { hint: redact(error.hint) } : {}),
  };
}

export class ParticipantRegistrationError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = "ParticipantRegistrationError";
  }
}

async function setParticipantSession(rawSession: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie, rawSession, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionLifetimeSeconds,
  });
}

export async function registerParticipant(input: {
  email: string;
  cityId: string;
  zoneId: string;
}): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ParticipantRegistrationError("Enter a valid email address.");
  }
  if (!input.cityId) {
    throw new ParticipantRegistrationError("Choose a city.");
  }
  if (!isUuid(input.cityId)) {
    throw new ParticipantRegistrationError("The selected city is invalid.");
  }
  if (!input.zoneId) {
    throw new ParticipantRegistrationError("Choose a zone.");
  }
  if (!isUuid(input.zoneId)) {
    throw new ParticipantRegistrationError("The selected zone is invalid.");
  }

  const rawSession = randomBytes(32).toString("base64url");
  const sessionExpiresAt = new Date(
    Date.now() + sessionLifetimeSeconds * 1000,
  );
  const supabase = createServiceClient();
  console.info("[participant-registration]", {
    operation: "register",
    stage: "register_participant_rpc",
  });
  const { data, error } = await supabase.rpc("register_participant", {
    p_email: email,
    p_city_id: input.cityId,
    p_zone_id: input.zoneId,
    p_session_token_hash: hashSecret(rawSession),
    p_session_expires_at: sessionExpiresAt.toISOString(),
  });
  if (error || !data?.[0]?.participant_id) {
    console.error("[participant-registration]", {
      operation: "register",
      stage: "register_participant_rpc",
      error: error
        ? sanitizedDatabaseError(error)
        : { code: "missing-participant-id", message: "RPC returned no participant." },
    });
    throw new ParticipantRegistrationError(
      "Registration is temporarily unavailable. Please try again later.",
    );
  }

  await setParticipantSession(rawSession);
  console.info("[participant-registration]", {
    operation: "register",
    stage: "session-cookie",
  });
  return { ok: true };
}

async function getParticipantId(): Promise<string | null> {
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
  return data?.participant_id ?? null;
}

export async function submitParticipantSurvey(input: {
  cityId: string;
  zoneId: string;
  answers: Array<{ question_id: string; answer: unknown }>;
  publicDisplay: boolean;
  futureCommunication: boolean;
}) {
  const participantId = await getParticipantId();
  if (!participantId) {
    throw new Error("Register before submitting the survey.");
  }

  const questions = await getActiveQuestions(input.cityId);
  if (
    !questions.length ||
    new Set(questions.map((question) => question.survey_version)).size !== 1
  ) {
    throw new Error("The active questionnaire is unavailable.");
  }
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const submittedIds = new Set(input.answers.map((answer) => answer.question_id));
  if (
    questions.some(
      (question) => question.is_required && !submittedIds.has(question.id),
    )
  ) {
    throw new Error("Please answer every required question.");
  }
  if (input.answers.some((answer) => !questionMap.has(answer.question_id))) {
    throw new Error("One or more answers are not part of the active questionnaire.");
  }
  for (const submitted of input.answers) {
    const question = questionMap.get(submitted.question_id);
    if (!question) continue;
    const isCheckboxes = question.question_type === "checkboxes";
    const selected = isCheckboxes && Array.isArray(submitted.answer)
      ? submitted.answer.map(String)
      : [];
    const value = typeof submitted.answer === "string"
      ? submitted.answer.trim()
      : "";
    const rules = question.validation_rules;
    if (
      question.is_required &&
      (isCheckboxes ? selected.length === 0 : !value)
    ) {
      throw new Error("Please answer every required question.");
    }
    const allowedValues = Array.isArray(rules.allowed_values)
      ? rules.allowed_values.map(String)
      : question.options.map(String);
    if (isCheckboxes && selected.some((item) => !allowedValues.includes(item))) {
      throw new Error("One or more answers are not valid for the active questionnaire.");
    }
    if (!isCheckboxes && question.options.length && value && !allowedValues.includes(value)) {
      throw new Error("One or more answers are not valid for the active questionnaire.");
    }
    if (isCheckboxes) {
      const minItems = typeof rules.min_items === "number" ? rules.min_items : 0;
      const maxItems =
        typeof rules.max_items === "number" ? rules.max_items : Number.POSITIVE_INFINITY;
      const mutuallyExclusive = Array.isArray(rules.mutually_exclusive)
        ? rules.mutually_exclusive.map(String)
        : [];
      if (selected.length < minItems || selected.length > maxItems) {
        throw new Error("The number of selected options is not valid.");
      }
      if (
        mutuallyExclusive.some((item) => selected.includes(item)) &&
        selected.length > 1
      ) {
        throw new Error("Mutually exclusive options cannot be selected together.");
      }
    }
    if (
      question.question_type === "number" &&
      value &&
      Number.isNaN(Number(value))
    ) {
      throw new Error("A numeric answer is required for one of the questions.");
    }
    const minLength =
      typeof rules.min_length === "number" ? rules.min_length : undefined;
    const maxLength =
      typeof rules.max_length === "number" ? rules.max_length : undefined;
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
  if (error || !data?.[0]) {
    throw new Error(error?.message ?? "Unable to submit the survey.");
  }
  return data[0] as {
    submission_id: string;
    public_participant_id: string;
    submission_number: number;
    survey_version: string;
  };
}
