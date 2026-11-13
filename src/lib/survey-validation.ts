export function validateCheckboxSelection(input: {
  selected?: unknown;
  answer?: unknown;
  allowedValues: string[];
  required: boolean;
  minItems?: number;
  maxItems?: number;
  mutuallyExclusive?: string[];
  questionKey?: string;
}): string | null {
  const raw = input.answer !== undefined ? input.answer : input.selected;
  const {
    allowedValues,
    required,
    minItems = 0,
    maxItems = Number.POSITIVE_INFINITY,
    mutuallyExclusive = [],
  } = input;

  if (!Array.isArray(raw)) {
    return "Checkbox answer must be a JSON array of strings.";
  }

  if (raw.some((item) => typeof item !== "string")) {
    return "All checkbox options must be strings.";
  }

  const selected = raw as string[];

  // Reject duplicate selections
  if (new Set(selected).size !== selected.length) {
    return "Duplicate checkbox options cannot be selected.";
  }

  if (required && selected.length === 0) {
    return "Select at least one option.";
  }

  if (selected.some((value) => !allowedValues.includes(value))) {
    return "Choose only the listed options.";
  }

  if (selected.length < minItems) {
    return `Select at least ${minItems} option${minItems === 1 ? "" : "s"}.`;
  }

  if (selected.length > maxItems) {
    return `Select no more than ${maxItems} options.`;
  }

  if (mutuallyExclusive.some((value) => selected.includes(value)) && selected.length > 1) {
    return "Choose either a single special option or normal options.";
  }

  return null;
}

export function validateMultipleChoiceAnswer(input: {
  answer: unknown;
  allowedValues: string[];
  required: boolean;
  questionKey?: string;
}): string | null {
  const { answer, allowedValues, required } = input;
  if (typeof answer !== "string") {
    return "Answer must be a string.";
  }
  const trimmed = answer.trim();
  if (required && trimmed === "") {
    return "Please select an answer.";
  }
  if (trimmed !== "" && !allowedValues.includes(trimmed)) {
    return "Choose only from the listed options.";
  }
  return null;
}

export function validateTextAnswer(input: {
  answer: unknown;
  required: boolean;
  minLength?: number;
  maxLength?: number;
  questionKey?: string;
}): string | null {
  const { answer, required, minLength, maxLength } = input;
  if (typeof answer !== "string") {
    return "Answer must be a string.";
  }
  const trimmed = answer.trim();
  if (required && trimmed === "") {
    return "Please provide an answer.";
  }
  if (minLength !== undefined && trimmed.length > 0 && trimmed.length < minLength) {
    return `Answer must be at least ${minLength} characters.`;
  }
  if (maxLength !== undefined && trimmed.length > maxLength) {
    return `Answer cannot exceed ${maxLength} characters.`;
  }
  return null;
}

export function validateNumberAnswer(input: {
  answer: unknown;
  required: boolean;
  min?: number;
  max?: number;
  questionKey?: string;
}): string | null {
  const { answer, required, min, max } = input;
  if (typeof answer !== "number" && typeof answer !== "string") {
    return "Answer must be a numeric value.";
  }
  const str = String(answer).trim();
  if (required && str === "") {
    return "Please provide a numeric answer.";
  }
  if (str !== "") {
    if (!/^-?[0-9]+(?:\.[0-9]+)?$/u.test(str)) {
      return "Answer must be a valid number.";
    }
    const val = Number(str);
    if (min !== undefined && val < min) {
      return `Answer cannot be less than ${min}.`;
    }
    if (max !== undefined && val > max) {
      return `Answer cannot be greater than ${max}.`;
    }
  }
  return null;
}

export function validateLinearScaleAnswer(input: {
  answer: unknown;
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
  questionKey?: string;
}): string | null {
  const { answer, required, min, max, step = 1 } = input;
  if (typeof answer !== "number" && typeof answer !== "string") {
    return "Answer must be a numeric value.";
  }
  const str = String(answer).trim();
  if (required && str === "") {
    return "Please select a rating.";
  }
  if (str !== "") {
    if (!/^[0-9]+$/u.test(str)) {
      return "Rating must be a whole number.";
    }
    const val = Number(str);
    if (min !== undefined && val < min) {
      return `Rating cannot be below ${min}.`;
    }
    if (max !== undefined && val > max) {
      return `Rating cannot exceed ${max}.`;
    }
    if (min !== undefined && step !== undefined && Math.abs((val - min) % step) > 1e-9) {
      return `Rating must match step size ${step}.`;
    }
  }
  return null;
}

export function validateDateAnswer(input: {
  answer: unknown;
  required: boolean;
  questionKey?: string;
}): string | null {
  const { answer, required } = input;
  if (typeof answer !== "string") {
    return "Date answer must be a string.";
  }
  const trimmed = answer.trim();
  if (required && trimmed === "") {
    return "Please select a date.";
  }
  if (trimmed !== "" && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(trimmed)) {
    return "Date must be in YYYY-MM-DD format.";
  }
  return null;
}
