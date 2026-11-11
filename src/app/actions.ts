"use server";

import { getActiveQuestions, getActiveZones } from "@/lib/survey-data";
import {
  ParticipantRegistrationError,
  registerParticipant,
  submitParticipantSurvey,
} from "@/lib/participant-server";
import { getPublicResponseDetail } from "@/lib/insights-data";

export async function loadZones(cityId: string) {
  if (!cityId) return [];
  return getActiveZones(cityId);
}

export async function loadQuestions(cityId: string) {
  if (!cityId) return [];
  return getActiveQuestions(cityId);
}

export async function register(email: string, cityId: string, zoneId: string) {
  try {
    return await registerParticipant({ email, cityId, zoneId });
  } catch (error) {
    if (error instanceof ParticipantRegistrationError) {
      return { ok: false as const, message: error.publicMessage };
    }
    return {
      ok: false as const,
      message: "Registration is temporarily unavailable. Please try again later.",
    };
  }
}

export async function submitSurvey(input: {
  cityId: string;
  zoneId: string;
  answers: Array<{ question_id: string; answer: unknown }>;
  publicDisplay: boolean;
  futureCommunication: boolean;
}) {
  return submitParticipantSurvey(input);
}

export async function loadPublicResponseDetail(publicParticipantId: string, submissionNumber: number) {
  if (!publicParticipantId.trim() || !Number.isInteger(submissionNumber) || submissionNumber < 1) return null;
  return getPublicResponseDetail(publicParticipantId.trim(), submissionNumber);
}
