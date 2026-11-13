import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateCheckboxSelection,
  validateDateAnswer,
  validateLinearScaleAnswer,
  validateMultipleChoiceAnswer,
  validateNumberAnswer,
  validateTextAnswer,
} from "../../src/lib/survey-validation";

interface MockQuestion {
  id: string;
  question_key: string;
  question_type: string;
  is_required: boolean;
  options: string[];
  validation_rules: Record<string, unknown>;
  city_id: string | null;
  survey_version: string;
}

const mockV4Questions: MockQuestion[] = [
  {
    id: "q-1",
    question_key: "environment_setting",
    question_type: "multiple_choice",
    is_required: true,
    options: ["Residential area", "Commercial area", "Industrial area"],
    validation_rules: { allowed_values: ["Residential area", "Commercial area", "Industrial area"] },
    city_id: null,
    survey_version: "v4",
  },
  {
    id: "q-2",
    question_key: "observed_pollution_sources",
    question_type: "checkboxes",
    is_required: true,
    options: [
      "Vehicle exhaust", "Road dust", "Construction dust", "Industrial emissions",
      "Waste burning", "Diesel generators", "Household solid-fuel smoke",
      "Agricultural or seasonal burning", "I do not notice these sources", "Not sure",
    ],
    validation_rules: {
      allowed_values: [
        "Vehicle exhaust", "Road dust", "Construction dust", "Industrial emissions",
        "Waste burning", "Diesel generators", "Household solid-fuel smoke",
        "Agricultural or seasonal burning", "I do not notice these sources", "Not sure",
      ],
      min_items: 1,
      max_items: 10,
      mutually_exclusive: ["I do not notice these sources", "Not sure"],
    },
    city_id: null,
    survey_version: "v4",
  },
  {
    id: "q-3",
    question_key: "perceived_air_quality",
    question_type: "linear_scale",
    is_required: true,
    options: ["1", "2", "3", "4", "5"],
    validation_rules: { min: 1, max: 5, step: 1 },
    city_id: null,
    survey_version: "v4",
  },
  {
    id: "q-4",
    question_key: "air_quality_observation",
    question_type: "long_text",
    is_required: false,
    options: [],
    validation_rules: { max_length: 50 },
    city_id: null,
    survey_version: "v4",
  },
  {
    id: "q-city-1",
    question_key: "bbs_seasonal_dust_and_burning",
    question_type: "multiple_choice",
    is_required: false,
    options: ["Never", "Rarely", "Sometimes", "Often", "Daily", "Not sure"],
    validation_rules: { allowed_values: ["Never", "Rarely", "Sometimes", "Often", "Daily", "Not sure"] },
    city_id: "city-bbs",
    survey_version: "v4",
  },
];

function validateSubmissionPayload(
  cityId: string,
  answers: Array<{ question_id: string; answer: unknown }>,
  questions: MockQuestion[],
  researchConsent = true,
): string | null {
  if (!researchConsent) {
    return "Research participation consent is required to submit the survey.";
  }

  if (!Array.isArray(answers)) return "Answers must be supplied as a JSON array.";

  const questionMap = new Map(questions.map((q) => [q.id, q]));
  const seenIds = new Set<string>();

  for (const item of answers) {
    if (seenIds.has(item.question_id)) {
      return "Duplicate survey answers are not allowed.";
    }
    seenIds.add(item.question_id);

    const question = questionMap.get(item.question_id);
    if (!question) {
      return "One or more answers are not part of the active questionnaire.";
    }
    if (question.city_id !== null && question.city_id !== cityId) {
      return "City-specific question does not match submission city.";
    }
  }

  // Check required
  for (const q of questions) {
    if (q.is_required && (q.city_id === null || q.city_id === cityId)) {
      const submitted = answers.find((a) => a.question_id === q.id);
      if (!submitted || submitted.answer === null || submitted.answer === undefined) {
        return "Please answer every required question.";
      }
    }
  }

  // Validate answer types and values using strict validators
  for (const item of answers) {
    const q = questionMap.get(item.question_id)!;
    if (q.question_type === "checkboxes") {
      const error = validateCheckboxSelection({
        answer: item.answer,
        allowedValues: q.options,
        required: q.is_required,
        minItems: q.validation_rules.min_items as number,
        maxItems: q.validation_rules.max_items as number,
        mutuallyExclusive: q.validation_rules.mutually_exclusive as string[],
      });
      if (error) return error;
    } else if (q.question_type === "multiple_choice") {
      const error = validateMultipleChoiceAnswer({
        answer: item.answer,
        allowedValues: q.options,
        required: q.is_required,
      });
      if (error) return error;
    } else if (q.question_type === "linear_scale") {
      const error = validateLinearScaleAnswer({
        answer: item.answer,
        required: q.is_required,
        min: q.validation_rules.min as number,
        max: q.validation_rules.max as number,
        step: q.validation_rules.step as number,
      });
      if (error) return error;
    } else if (q.question_type === "long_text" || q.question_type === "short_text") {
      const error = validateTextAnswer({
        answer: item.answer,
        required: q.is_required,
        maxLength: q.validation_rules.max_length as number | undefined,
        minLength: q.validation_rules.min_length as number | undefined,
      });
      if (error) return error;
    }
  }

  return null;
}

test("validates complete correct submission payload", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust", "Road dust"] },
      { question_id: "q-3", answer: "4" },
    ],
    mockV4Questions,
    true,
  );
  assert.equal(result, null);
});

test("rejects missing affirmative research participation consent", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust", "Road dust"] },
      { question_id: "q-3", answer: "4" },
    ],
    mockV4Questions,
    false,
  );
  assert.equal(result, "Research participation consent is required to submit the survey.");
});

test("rejects missing required questions", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      // q-2 (checkboxes) and q-3 (rating) missing
    ],
    mockV4Questions,
  );
  assert.equal(result, "Please answer every required question.");
});

test("rejects duplicate answers for the same question", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-1", answer: "Commercial area" },
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3" },
    ],
    mockV4Questions,
  );
  assert.equal(result, "Duplicate survey answers are not allowed.");
});

test("rejects questions belonging to a different city", () => {
  const result = validateSubmissionPayload(
    "city-mumbai", // Submitted city is Mumbai
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3" },
      { question_id: "q-city-1", answer: "Often" }, // This is a Bhubaneswar-specific question!
    ],
    mockV4Questions,
  );
  assert.equal(result, "City-specific question does not match submission city.");
});

test("rejects invalid choice values in multiple choice", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Martian colony" }, // Invalid choice!
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3" },
    ],
    mockV4Questions,
  );
  assert.equal(result, "Choose only from the listed options.");
});

test("rejects non-string values in multiple choice", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: 123 }, // Invalid type!
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3" },
    ],
    mockV4Questions,
  );
  assert.equal(result, "Answer must be a string.");
});

test("rejects non-array and non-string in checkboxes", () => {
  const notArray = validateCheckboxSelection({
    answer: "Vehicle exhaust",
    allowedValues: ["Vehicle exhaust", "Road dust"],
    required: true,
  });
  assert.equal(notArray, "Checkbox answer must be a JSON array of strings.");

  const notStringElements = validateCheckboxSelection({
    answer: ["Vehicle exhaust", 42],
    allowedValues: ["Vehicle exhaust", "Road dust"],
    required: true,
  });
  assert.equal(notStringElements, "All checkbox options must be strings.");
});

test("rejects duplicate selected values in checkboxes", () => {
  const duplicateSelected = validateCheckboxSelection({
    answer: ["Vehicle exhaust", "Vehicle exhaust"],
    allowedValues: ["Vehicle exhaust", "Road dust"],
    required: true,
  });
  assert.equal(duplicateSelected, "Duplicate checkbox options cannot be selected.");
});

test("rejects mixing mutually exclusive option with regular options in pollution sources", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust", "I do not notice these sources"] },
      { question_id: "q-3", answer: "3" },
    ],
    mockV4Questions,
  );
  assert.equal(result, "Choose either a single special option or normal options.");
});

test("rejects invalid linear scale values", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "9" }, // Scale max is 5!
    ],
    mockV4Questions,
  );
  assert.equal(result, "Rating cannot exceed 5.");
});

test("rejects non-integer linear scale values", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3.5" },
    ],
    mockV4Questions,
  );
  assert.equal(result, "Rating must be a whole number.");
});

test("validates text length constraints", () => {
  const result = validateSubmissionPayload(
    "city-bbs",
    [
      { question_id: "q-1", answer: "Residential area" },
      { question_id: "q-2", answer: ["Vehicle exhaust"] },
      { question_id: "q-3", answer: "3" },
      { question_id: "q-4", answer: "A".repeat(51) }, // Exceeds max_length 50!
    ],
    mockV4Questions,
  );
  assert.equal(result, "Answer cannot exceed 50 characters.");
});

test("validates number answer constraints", () => {
  assert.equal(
    validateNumberAnswer({ answer: "abc", required: true }),
    "Answer must be a valid number.",
  );
  assert.equal(
    validateNumberAnswer({ answer: 15, required: true, max: 10 }),
    "Answer cannot be greater than 10.",
  );
  assert.equal(
    validateNumberAnswer({ answer: 2, required: true, min: 5 }),
    "Answer cannot be less than 5.",
  );
  assert.equal(
    validateNumberAnswer({ answer: "42.5", required: true, min: 0, max: 100 }),
    null,
  );
});

test("validates date answer format", () => {
  assert.equal(
    validateDateAnswer({ answer: "2026/05/01", required: true }),
    "Date must be in YYYY-MM-DD format.",
  );
  assert.equal(
    validateDateAnswer({ answer: "01-05-2026", required: true }),
    "Date must be in YYYY-MM-DD format.",
  );
  assert.equal(
    validateDateAnswer({ answer: "2026-05-01", required: true }),
    null,
  );
});
