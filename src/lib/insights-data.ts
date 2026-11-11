import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

export const ACTIVE_SURVEY_VERSION = "v2";
export const PUBLIC_DISPLAY_CONSENT_VERSION = "public-display-v2";
export const CITY_RESPONSE_THRESHOLD = 1;
export const CATEGORY_SUPPRESSION_THRESHOLD = 5;

const publicQuestionKeys = [
  "perceived_air_quality",
  "public_transport_awareness",
  "main_transport_mode",
  "observed_pollution_sources",
  "traffic_exposure",
  "construction_activity",
  "waste_burning",
  "aqi_awareness",
  "improvement_priority",
] as const;

type PublicQuestionKey = (typeof publicQuestionKeys)[number];
type SubmissionRow = {
  id: string;
  participant_id: string;
  city_id: string;
  submission_date: string;
  created_at: string;
  submission_number: number;
  survey_version: string;
};
type AnswerRow = { submission_id: string; question_id: string; answer: unknown };
type QuestionRow = {
  id: string;
  question_key: string;
  question_text: string;
  question_type: string;
  options: unknown;
  validation_rules: unknown;
  survey_version: string;
};
type CityRow = { id: string; slug: string; name: string };

export type InsightDistribution = { key: string; label: string; count: number; percentage: number };
export type InsightMetric = {
  key: PublicQuestionKey;
  question: string;
  sampleSize: number;
  distribution: InsightDistribution[];
};
export type InsightCity = {
  slug: string;
  name: string;
  responseCount: number;
  eligible: boolean;
  metrics: InsightMetric[];
};
export type PublicResponseSummary = {
  publicParticipantId: string;
  city: string;
  submittedAt: string;
  submissionNumber: number;
};
export type PublicResponseDetail = PublicResponseSummary & {
  surveyVersion: string;
  answers: Array<{ label: string; answer: string | string[] }>;
};
export type PublicInsights = {
  surveyVersion: string;
  responseCount: number;
  participatingCityCount: number;
  averageAirQuality: number | null;
  averageTransportAwareness: number | null;
  cities: InsightCity[];
  metrics: InsightMetric[];
  responseTrend: Array<{ date: string; count: number }>;
  recentResponses: PublicResponseSummary[];
  suppressionThreshold: number;
};

const cityCatalog = [
  { slug: "bhubaneswar", name: "Bhubaneswar" },
  { slug: "mumbai", name: "Mumbai" },
  { slug: "bengaluru", name: "Bengaluru" },
  { slug: "jamshedpur", name: "Jamshedpur" },
  { slug: "patna", name: "Patna" },
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function formatOption(value: string, rules: Record<string, unknown>): string {
  const labels = asRecord(rules.labels);
  return typeof labels[value] === "string" ? labels[value] : value;
}
function answerValues(answer: unknown, question: QuestionRow): string[] {
  const values = Array.isArray(answer) ? answer.map(asString) : [asString(answer)];
  const rules = asRecord(question.validation_rules);
  const options = Array.isArray(question.options) ? question.options.map(asString).filter((value): value is string => value !== null) : [];
  const allowed = Array.isArray(rules.allowed_values) ? rules.allowed_values.map(asString).filter((value): value is string => value !== null) : options;
  return values.filter((value): value is string => value !== null).filter((value) => {
    if (question.question_type === "linear_scale") {
      const number = Number(value);
      const min = asNumber(rules.min);
      const max = asNumber(rules.max);
      return Number.isInteger(number) && (min === null || number >= min) && (max === null || number <= max);
    }
    return allowed.length ? allowed.includes(value) : true;
  });
}

function buildMetric(key: PublicQuestionKey, question: QuestionRow | undefined, answers: AnswerRow[], submissionIds: Set<string>): InsightMetric {
  const fallback: QuestionRow = {
    id: "", question_key: key, question_text: key.replaceAll("_", " "), question_type: "short_text",
    options: [], validation_rules: {}, survey_version: ACTIVE_SURVEY_VERSION,
  };
  const selectedQuestion = question ?? fallback;
  const rules = asRecord(selectedQuestion.validation_rules);
  const options = Array.isArray(selectedQuestion.options) ? selectedQuestion.options.map(asString).filter((value): value is string => value !== null) : [];
  const counts = new Map<string, number>();
  const values = answers
    .filter((answer) => submissionIds.has(answer.submission_id) && answer.question_id === selectedQuestion.id)
    .flatMap((answer) => answerValues(answer.answer, selectedQuestion));
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const orderedKeys = options.length ? options : [...counts.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return {
    key, question: selectedQuestion.question_text, sampleSize: values.length,
    distribution: orderedKeys.filter((value) => counts.has(value)).map((value) => ({
      key: value, label: formatOption(value, rules), count: counts.get(value) ?? 0,
      percentage: values.length ? ((counts.get(value) ?? 0) / values.length) * 100 : 0,
    })),
  };
}
function emptyMetric(key: PublicQuestionKey): InsightMetric {
  return { key, question: key.replaceAll("_", " "), sampleSize: 0, distribution: [] };
}
function averageForMetric(metric: InsightMetric): number | null {
  if (!metric.sampleSize) return null;
  return metric.distribution.reduce((sum, item) => sum + Number(item.key) * item.count, 0) / metric.sampleSize;
}

type EligibleDataset = {
  submissions: SubmissionRow[];
  answers: AnswerRow[];
  questions: QuestionRow[];
  cities: CityRow[];
};

export async function getEligiblePublicDataset(): Promise<EligibleDataset> {
  const supabase = createServiceClient();
  const [{ data: submissions, error: submissionError }, { data: cities, error: cityError }] = await Promise.all([
    supabase.from("survey_submissions")
      .select("id, participant_id, city_id, submission_date, created_at, submission_number, survey_version")
      .eq("moderation_status", "approved").eq("public_visibility", true)
      .eq("survey_version", ACTIVE_SURVEY_VERSION).order("created_at", { ascending: false }),
    supabase.from("cities").select("id, slug, name").eq("is_active", true),
  ]);
  if (submissionError || cityError) throw new Error("Unable to load public survey insights.");
  const submissionRows = (submissions ?? []) as SubmissionRow[];
  if (!submissionRows.length) return { submissions: [], answers: [], questions: [], cities: (cities ?? []) as CityRow[] };

  const ids = submissionRows.map((submission) => submission.id);
  const { data: consentRows, error: consentError } = await supabase.from("consent_records")
    .select("submission_id, consent_event, consent_version, event_provenance, event_sequence")
    .eq("consent_type", "public_display").in("submission_id", ids)
    .order("event_sequence", { ascending: false });
  if (consentError) throw new Error("Unable to verify public-display consent.");
  const latestConsent = new Map<string, { event: string; version: string; provenance: string }>();
  for (const consent of consentRows ?? []) {
    if (!latestConsent.has(consent.submission_id)) {
      latestConsent.set(consent.submission_id, {
        event: consent.consent_event, version: consent.consent_version, provenance: consent.event_provenance,
      });
    }
  }
  const eligible = submissionRows.filter((submission) => {
    const consent = latestConsent.get(submission.id);
    return consent?.event === "granted" &&
      consent.version === PUBLIC_DISPLAY_CONSENT_VERSION &&
      consent.provenance !== "legacy_ambiguous";
  });
  if (!eligible.length) return { submissions: [], answers: [], questions: [], cities: (cities ?? []) as CityRow[] };

  const eligibleIds = eligible.map((submission) => submission.id);
  const [{ data: answers, error: answerError }, { data: questions, error: questionError }] = await Promise.all([
    supabase.from("survey_answers").select("submission_id, question_id, answer").in("submission_id", eligibleIds),
    supabase.from("survey_questions")
      .select("id, question_key, question_text, question_type, options, validation_rules, survey_version")
      .eq("survey_version", ACTIVE_SURVEY_VERSION).eq("is_active", true),
  ]);
  if (answerError || questionError) throw new Error("Unable to load public response aggregates.");
  return {
    submissions: eligible, answers: (answers ?? []) as AnswerRow[],
    questions: (questions ?? []) as QuestionRow[], cities: (cities ?? []) as CityRow[],
  };
}

function summaryForSubmission(submission: SubmissionRow, cities: CityRow[], participantId: string): PublicResponseSummary {
  return {
    publicParticipantId: participantId,
    city: cities.find((city) => city.id === submission.city_id)?.name ?? "Unknown city",
    submittedAt: submission.created_at,
    submissionNumber: submission.submission_number,
  };
}

export async function getPublicResponseFeed(limit = 12): Promise<PublicResponseSummary[]> {
  const dataset = await getEligiblePublicDataset();
  if (!dataset.submissions.length) return [];
  const supabase = createServiceClient();
  const participantIds = [...new Set(dataset.submissions.slice(0, limit).map((submission) => submission.participant_id))];
  const { data, error } = await supabase.from("participants").select("id, public_participant_id").in("id", participantIds);
  if (error) throw new Error("Unable to load recent public responses.");
  const ids = new Map((data ?? []).map((participant) => [participant.id, participant.public_participant_id]));
  return dataset.submissions.slice(0, limit).flatMap((submission) => {
    const publicId = ids.get(submission.participant_id);
    return publicId ? [summaryForSubmission(submission, dataset.cities, publicId)] : [];
  });
}

export async function getPublicResponseDetail(publicParticipantId: string, submissionNumber: number): Promise<PublicResponseDetail | null> {
  const supabase = createServiceClient();
  const { data: participant, error: participantError } = await supabase.from("participants")
    .select("id, public_participant_id").eq("public_participant_id", publicParticipantId).maybeSingle();
  if (participantError || !participant) return null;
  const dataset = await getEligiblePublicDataset();
  const submission = dataset.submissions.find((candidate) =>
    candidate.participant_id === participant.id && candidate.submission_number === submissionNumber);
  if (!submission) return null;
  const questions = dataset.questions.filter((question) => !["short_text", "long_text"].includes(question.question_type));
  const questionIds = new Set(questions.map((question) => question.id));
  const answers = dataset.answers.filter((answer) => answer.submission_id === submission.id && questionIds.has(answer.question_id));
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  return {
    ...summaryForSubmission(submission, dataset.cities, participant.public_participant_id),
    surveyVersion: ACTIVE_SURVEY_VERSION,
    answers: answers.flatMap((answer) => {
      const question = questionMap.get(answer.question_id);
      if (!question) return [];
      const values = answerValues(answer.answer, question);
      return values.length ? [{ label: question.question_text, answer: values.length === 1 ? formatOption(values[0], asRecord(question.validation_rules)) : values.map((value) => formatOption(value, asRecord(question.validation_rules))) }] : [];
    }),
  };
}

export async function getPublicInsights(): Promise<PublicInsights> {
  const dataset = await getEligiblePublicDataset();
  const selectedIds = new Set(dataset.submissions.map((submission) => submission.id));
  const questionMap = new Map(dataset.questions.map((question) => [question.question_key, question]));
  const allMetrics = publicQuestionKeys.map((key) => buildMetric(key, questionMap.get(key), dataset.answers, selectedIds));
  const cityCounts = new Map<string, SubmissionRow[]>();
  for (const submission of dataset.submissions) cityCounts.set(submission.city_id, [...(cityCounts.get(submission.city_id) ?? []), submission]);
  const cities = cityCatalog.map((catalogCity) => {
    const city = dataset.cities.find((candidate) => candidate.slug === catalogCity.slug);
    const submissions = city ? cityCounts.get(city.id) ?? [] : [];
    const ids = new Set(submissions.map((submission) => submission.id));
    return {
      ...catalogCity, responseCount: submissions.length, eligible: submissions.length >= CITY_RESPONSE_THRESHOLD,
      metrics: submissions.length >= CITY_RESPONSE_THRESHOLD ? publicQuestionKeys.map((key) => buildMetric(key, questionMap.get(key), dataset.answers, ids)) : [],
    };
  });
  const trend = new Map<string, number>();
  for (const submission of dataset.submissions) trend.set(submission.submission_date, (trend.get(submission.submission_date) ?? 0) + 1);
  return {
    surveyVersion: ACTIVE_SURVEY_VERSION, responseCount: dataset.submissions.length,
    participatingCityCount: cities.filter((city) => city.responseCount > 0).length,
    averageAirQuality: averageForMetric(allMetrics.find((metric) => metric.key === "perceived_air_quality") ?? emptyMetric("perceived_air_quality")),
    averageTransportAwareness: averageForMetric(allMetrics.find((metric) => metric.key === "public_transport_awareness") ?? emptyMetric("public_transport_awareness")),
    cities, metrics: allMetrics,
    responseTrend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    recentResponses: await getPublicResponseFeed(),
    suppressionThreshold: CATEGORY_SUPPRESSION_THRESHOLD,
  };
}

export async function getPublicCityInsights(citySlug: string): Promise<{ insights: PublicInsights; city: InsightCity | undefined }> {
  const insights = await getPublicInsights();
  return { insights, city: insights.cities.find((candidate) => candidate.slug === citySlug) };
}
