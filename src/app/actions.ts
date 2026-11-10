"use server";

import { getActiveQuestions, getActiveZones } from "@/lib/survey-data";
import {
  getVerifiedParticipantId,
  logParticipantVerificationFailure,
  ParticipantVerificationError,
  requestParticipantVerification,
  submitParticipantSurvey,
} from "@/lib/participant-server";

export async function loadZones(cityId: string) {
  if (!cityId) return [];
  return getActiveZones(cityId);
}

export async function loadQuestions(cityId: string) {
  if (!cityId) return [];
  return getActiveQuestions(cityId);
}

export async function requestVerification(email: string, cityId: string) {
  try {
    return await requestParticipantVerification({ email, cityId });
  } catch (error) {
    if (error instanceof ParticipantVerificationError) {
      return { ok: false as const, message: error.publicMessage };
    }
    logParticipantVerificationFailure("server-action", error);
    return {
      ok: false as const,
      message: "Verification is temporarily unavailable. Please try again later.",
    };
  }
}

export async function checkParticipantSession() {
  return Boolean(await getVerifiedParticipantId());
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
