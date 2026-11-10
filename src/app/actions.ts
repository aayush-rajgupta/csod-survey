"use server";

import { getActiveQuestions, getActiveZones } from "@/lib/survey-data";
import {
  getVerifiedParticipantId,
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
  return requestParticipantVerification({ email, cityId });
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
