"use server";

import { getActiveQuestions, getActiveZones } from "@/lib/survey-data";
import {
  ParticipantRegistrationError,
  registerParticipant,
  submitParticipantSurvey,
} from "@/lib/participant-server";
import { getPublicResponseDetail } from "@/lib/insights-data";
import type { DailyActivityEntry } from "@/lib/daily-activity";
import {
  adminHideSubmission as adminHide,
  adminRestoreSubmission as adminRestore,
  adminSetModeration as adminSetMod,
  adminRetrySubmissionNotification as adminRetryNotif,
} from "@/lib/admin-server";

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
  researchConsent: boolean;
  publicDisplay: boolean;
  futureCommunication: boolean;
  dailyActivities: DailyActivityEntry[];
}) {
  return submitParticipantSurvey(input);
}

export async function loadPublicResponseDetail(
  publicParticipantId: string,
  submissionNumber: number,
) {
  if (!publicParticipantId.trim() || !Number.isInteger(submissionNumber)) {
    return null;
  }
  return getPublicResponseDetail(publicParticipantId.trim(), submissionNumber);
}

export async function adminHideSubmission(submissionId: string) {
  return adminHide(submissionId);
}

export async function adminRestoreSubmission(submissionId: string) {
  return adminRestore(submissionId);
}

export async function adminSetModeration(
  submissionId: string,
  status: "approved" | "rejected" | "pending",
) {
  return adminSetMod(submissionId, status);
}

export async function adminRetryNotification(submissionId: string) {
  return adminRetryNotif(submissionId);
}
