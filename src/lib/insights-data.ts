import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

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
  city_id: string;
  submission_date: string;
  survey_version: string;
};

type AnswerRow = {
  submission_id: string;
  question_id: string;
  answer: unknown;
};

type QuestionRow = {
  id: string;
  question_key: string;
  question_text: string;
  question_type: string;
  options: unknown;
  validation_rules: unknown;
  survey_version: string;
};

export type InsightDistribution = {
  key: string;
  label: string;
  count: number;
  percentage: number;
};

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

export type PublicInsights = {
  surveyVersion: string;
  responseCount: number;
  participatingCityCount: number;
  averageAirQuality: number | null;
  averageTransportAwareness: number | null;
  cities: InsightCity[];
  metrics: InsightMetric[];
  responseTrend: Array<{ date: string; count: number }>;
  dailyMetrics: Record<string, InsightMetric[]>;
  availableDates: string[];
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
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function versionRank(version: string): number {
  const match = version.match(/\d+/u);
  return match ? Number(match[0]) : 0;
}

function formatOption(value: string, rules: Record<string, unknown>): string {
  const labels = asRecord(rules.labels);
  return typeof labels[value] === "string" ? labels[value] : value;
}

function isIntegerScaleValue(
  value: string,
  rules: Record<string, unknown>,
): boolean {
  const numeric = Number(value);
  const minimum = asNumber(rules.min);
  const maximum = asNumber(rules.max);
  const step = asNumber(rules.step);
  return (
    Number.isInteger(numeric) &&
    (minimum === null || numeric >= minimum) &&
    (maximum === null || numeric <= maximum) &&
    (step === null || Math.abs((numeric - (minimum ?? 0)) / step - Math.round((numeric - (minimum ?? 0)) / step)) < 1e-9)
  );
}

function answerValues(answer: unknown, question: QuestionRow): string[] {
  const values = Array.isArray(answer) ? answer.map(asString) : [asString(answer)];
  const rules = asRecord(question.validation_rules);
  const options = Array.isArray(question.options)
    ? question.options.map(asString).filter((value): value is string => value !== null)
    : [];
  const allowed = Array.isArray(rules.allowed_values)
    ? rules.allowed_values.map(asString).filter((value): value is string => value !== null)
    : options;

  return values
    .filter((value): value is string => value !== null)
    .filter((value) =>
      question.question_type === "linear_scale"
        ? isIntegerScaleValue(value, rules)
        : allowed.length
          ? allowed.includes(value)
          : true,
    );
}

function buildMetric(
  key: PublicQuestionKey,
  question: QuestionRow | undefined,
  answers: AnswerRow[],
  submissionIds: Set<string>,
): InsightMetric {
  const questionText = question?.question_text ?? key.replaceAll("_", " ");
  const counts = new Map<string, number>();
  const rules = asRecord(question?.validation_rules);
  const options = Array.isArray(question?.options)
    ? question.options.map(asString).filter((value): value is string => value !== null)
    : [];
  const values = answers
    .filter((answer) => submissionIds.has(answer.submission_id))
    .flatMap((answer) => answerValues(answer.answer, question ?? {
      id: "",
      question_key: key,
      question_text: questionText,
      question_type: "short_text",
      options: [],
      validation_rules: {},
      survey_version: "",
    }));

  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sampleSize = values.length;
  const orderedKeys = options.length ? options : [...counts.keys()].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

  return {
    key,
    question: questionText,
    sampleSize,
    distribution: orderedKeys
      .filter((value) => counts.has(value))
      .map((value) => ({
        key: value,
        label: formatOption(value, rules),
        count: counts.get(value) ?? 0,
        percentage: sampleSize ? ((counts.get(value) ?? 0) / sampleSize) * 100 : 0,
      })),
  };
}

function averageForMetric(metric: InsightMetric): number | null {
  if (!metric.sampleSize) return null;
  const total = metric.distribution.reduce(
    (sum, item) => sum + Number(item.key) * item.count,
    0,
  );
  return Number.isFinite(total) ? total / metric.sampleSize : null;
}

function emptyMetric(key: PublicQuestionKey): InsightMetric {
  return { key, question: key.replaceAll("_", " "), sampleSize: 0, distribution: [] };
}

export async function getPublicInsights(): Promise<PublicInsights> {
  const supabase = createServiceClient();
  const [{ data: submissions, error: submissionError }, { data: cities, error: cityError }] =
    await Promise.all([
      supabase
        .from("survey_submissions")
        .select("id, city_id, submission_date, survey_version")
        .eq("public_visibility", true)
        .eq("moderation_status", "approved"),
      supabase.from("cities").select("id, slug, name").eq("is_active", true),
    ]);

  if (submissionError || cityError) {
    throw new Error("Unable to load public survey insights.");
  }

  const submissionRows = (submissions ?? []) as SubmissionRow[];
  const submissionIds = submissionRows.map((submission) => submission.id);
  if (!submissionIds.length) {
    return {
      surveyVersion: "none",
      responseCount: 0,
      participatingCityCount: 0,
      averageAirQuality: null,
      averageTransportAwareness: null,
      cities: cityCatalog.map((city) => ({ ...city, responseCount: 0, eligible: false, metrics: [] })),
      metrics: publicQuestionKeys.map(emptyMetric),
      responseTrend: [],
      dailyMetrics: {},
      availableDates: [],
      suppressionThreshold: 10,
    };
  }

  const { data: consentRows, error: consentError } = await supabase
    .from("consent_records")
    .select("submission_id, consent_event, event_provenance, event_sequence")
    .eq("consent_type", "public_display")
    .in("submission_id", submissionIds)
    .order("event_sequence", { ascending: false });
  if (consentError) throw new Error("Unable to verify public-display consent.");

  const latestConsent = new Map<string, { event: string; provenance: string }>();
  for (const consent of consentRows ?? []) {
    if (!latestConsent.has(consent.submission_id)) {
      latestConsent.set(consent.submission_id, {
        event: consent.consent_event,
        provenance: consent.event_provenance,
      });
    }
  }
  const eligibleSubmissions = submissionRows.filter((submission) => {
    const consent = latestConsent.get(submission.id);
    return consent?.event === "granted" && consent.provenance !== "legacy_ambiguous";
  });
  const versions = [...new Set(eligibleSubmissions.map((submission) => submission.survey_version))]
    .sort((a, b) => versionRank(b) - versionRank(a));
  const surveyVersion = versions[0] ?? "none";
  const selectedSubmissions = eligibleSubmissions.filter(
    (submission) => submission.survey_version === surveyVersion,
  );
  const selectedIds = selectedSubmissions.map((submission) => submission.id);

  if (!selectedIds.length) {
    return {
      surveyVersion,
      responseCount: 0,
      participatingCityCount: 0,
      averageAirQuality: null,
      averageTransportAwareness: null,
      cities: cityCatalog.map((city) => ({ ...city, responseCount: 0, eligible: false, metrics: [] })),
      metrics: publicQuestionKeys.map(emptyMetric),
      responseTrend: [],
      dailyMetrics: {},
      availableDates: [],
      suppressionThreshold: 10,
    };
  }

  const [{ data: answers, error: answerError }, { data: questions, error: questionError }] =
    await Promise.all([
      supabase
        .from("survey_answers")
        .select("submission_id, question_id, answer")
        .in("submission_id", selectedIds),
      supabase
        .from("survey_questions")
        .select("id, question_key, question_text, question_type, options, validation_rules, survey_version")
        .eq("survey_version", surveyVersion)
        .in("question_key", [...publicQuestionKeys]),
    ]);
  if (answerError || questionError) throw new Error("Unable to load public response aggregates.");

  const questionMap = new Map(
    ((questions ?? []) as QuestionRow[]).map((question) => [question.question_key, question]),
  );
  const answerRows = (answers ?? []) as AnswerRow[];
  const selectedIdSet = new Set(selectedIds);
  const allMetrics = publicQuestionKeys.map((key) =>
    buildMetric(key, questionMap.get(key), answerRows, selectedIdSet),
  );
  const cityRows = (cities ?? []) as Array<{ id: string; slug: string; name: string }>;
  const citiesWithResponses = new Map<string, SubmissionRow[]>();
  for (const submission of selectedSubmissions) {
    const list = citiesWithResponses.get(submission.city_id) ?? [];
    list.push(submission);
    citiesWithResponses.set(submission.city_id, list);
  }
  const metricsByKey = new Map(allMetrics.map((metric) => [metric.key, metric]));
  const insightCities = cityCatalog.map((catalogCity) => {
    const city = cityRows.find((candidate) => candidate.slug === catalogCity.slug);
    const citySubmissions = city ? citiesWithResponses.get(city.id) ?? [] : [];
    const cityIds = new Set(citySubmissions.map((submission) => submission.id));
    return {
      ...catalogCity,
      responseCount: citySubmissions.length,
      eligible: citySubmissions.length >= 10,
      metrics: citySubmissions.length >= 10
        ? publicQuestionKeys.map((key) => buildMetric(key, questionMap.get(key), answerRows, cityIds))
        : [],
    };
  });
  const trend = new Map<string, number>();
  const dailySubmissionIds = new Map<string, Set<string>>();
  for (const submission of selectedSubmissions) {
    trend.set(submission.submission_date, (trend.get(submission.submission_date) ?? 0) + 1);
    const idsForDate = dailySubmissionIds.get(submission.submission_date) ?? new Set<string>();
    idsForDate.add(submission.id);
    dailySubmissionIds.set(submission.submission_date, idsForDate);
  }
  const dailyMetrics = Object.fromEntries(
    [...dailySubmissionIds.entries()].map(([date, ids]) => [
      date,
      publicQuestionKeys.map((key) => buildMetric(key, questionMap.get(key), answerRows, ids)),
    ]),
  );

  return {
    surveyVersion,
    responseCount: selectedSubmissions.length,
    participatingCityCount: insightCities.filter((city) => city.responseCount > 0).length,
    averageAirQuality: averageForMetric(metricsByKey.get("perceived_air_quality") ?? emptyMetric("perceived_air_quality")),
    averageTransportAwareness: averageForMetric(metricsByKey.get("public_transport_awareness") ?? emptyMetric("public_transport_awareness")),
    cities: insightCities,
    metrics: allMetrics,
    responseTrend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
    dailyMetrics,
    availableDates: [...trend.keys()].sort(),
    suppressionThreshold: 10,
  };
}

export async function getPublicCityInsights(citySlug: string): Promise<{
  insights: PublicInsights;
  city: InsightCity | undefined;
}> {
  const insights = await getPublicInsights();
  return { insights, city: insights.cities.find((candidate) => candidate.slug === citySlug) };
}
