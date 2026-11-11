"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";

import {
  loadQuestions,
  loadZones,
  register,
  submitSurvey,
} from "@/app/actions";
import type { City, SurveyQuestion, Zone } from "@/lib/survey-data";

type Props = { cities: City[] };
type Step = "welcome" | "profile" | "survey" | "consent" | "review" | "confirmation";
type AnswerValue = string | string[];

const steps: Array<{ key: Step; label: string }> = [
  { key: "profile", label: "About you" },
  { key: "survey", label: "Survey" },
  { key: "consent", label: "Choices" },
  { key: "review", label: "Review" },
];

export default function ParticipantExperience({
  cities,
}: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [cityId, setCityId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [email, setEmail] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [researchConsent, setResearchConsent] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [communicationConsent, setCommunicationConsent] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    publicId: string;
    number: number;
  }>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const questionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const selectedCity = cities.find((city) => city.id === cityId);
  const currentStep = steps.findIndex(({ key }) => key === step);

  async function chooseCity(value: string) {
    setCityId(value);
    setZoneId("");
    setMessage("");
    if (!value) {
      setZones([]);
      return;
    }
    setLoading(true);
    try {
      setZones(await loadZones(value));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load zones.");
    } finally {
      setLoading(false);
    }
  }

  async function continueFromProfile() {
    if (!cityId || !zoneId || !email.trim()) {
      setMessage("Choose your city and zone, then enter a private email address.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const registration = await register(email, cityId, zoneId);
      if (!registration.ok) {
        setMessage(registration.message);
        return;
      }
      setQuestions(await loadQuestions(cityId));
      setStep("survey");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue.");
    } finally {
      setLoading(false);
    }
  }

  function updateAnswer(questionId: string, value: AnswerValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

  function isQuestionVisible(question: SurveyQuestion): boolean {
    const rule = question.visibility_rule;
    if (!rule || typeof rule !== "object") return true;
    const questionKey =
      typeof rule.question_key === "string" ? rule.question_key : undefined;
    if (!questionKey) return true;
    const controllingQuestion = questions.find(
      (candidate) => candidate.question_key === questionKey,
    );
    if (!controllingQuestion) return true;
    const expected = rule.value ?? rule.equals;
    if (expected === undefined) return true;
    const answer = answers[controllingQuestion.id];
    return Array.isArray(answer)
      ? answer.includes(String(expected))
      : String(answer ?? "") === String(expected);
  }

  function validateQuestionAnswer(
    question: SurveyQuestion,
    answer: AnswerValue | undefined,
  ): string | null {
    const rules = question.validation_rules;
    const allowedValues = Array.isArray(rules.allowed_values)
      ? rules.allowed_values.map(String)
      : question.options.map(String);

    if (question.question_type === "checkboxes") {
      const selected = Array.isArray(answer) ? answer : [];
      if (question.is_required && selected.length === 0) {
        return "Select at least one option.";
      }
      if (selected.some((value) => !allowedValues.includes(value))) {
        return "Choose only the listed options.";
      }
      const minItems = typeof rules.min_items === "number" ? rules.min_items : 0;
      const maxItems =
        typeof rules.max_items === "number" ? rules.max_items : Number.POSITIVE_INFINITY;
      if (selected.length < minItems) {
        return `Select at least ${minItems} option${minItems === 1 ? "" : "s"}.`;
      }
      if (selected.length > maxItems) {
        return `Select no more than ${maxItems} options.`;
      }
      const mutuallyExclusive = Array.isArray(rules.mutually_exclusive)
        ? rules.mutually_exclusive.map(String)
        : [];
      if (
        mutuallyExclusive.some((value) => selected.includes(value)) &&
        selected.length > 1
      ) {
        return "Choose either a single 'Not sure' or 'I do not notice these sources' option.";
      }
      return null;
    }

    const value = typeof answer === "string" ? answer.trim() : "";
    if (!value) {
      return question.is_required ? "This question is required." : null;
    }
    if (
      ["multiple_choice", "dropdown"].includes(question.question_type) &&
      !allowedValues.includes(value)
    ) {
      return "Choose one of the listed options.";
    }
    if (["number", "linear_scale"].includes(question.question_type)) {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) return "Enter a valid number.";
      if (typeof rules.min === "number" && numericValue < rules.min) {
        return `Enter a number of at least ${rules.min}.`;
      }
      if (typeof rules.max === "number" && numericValue > rules.max) {
        return `Enter a number no greater than ${rules.max}.`;
      }
      if (
        typeof rules.step === "number" &&
        Math.abs(numericValue / rules.step - Math.round(numericValue / rules.step)) > 1e-9
      ) {
        return `Enter a number in steps of ${rules.step}.`;
      }
    }
    if (question.question_type === "long_text") {
      if (
        typeof rules.min_length === "number" &&
        value.length < rules.min_length
      ) {
        return `Enter at least ${rules.min_length} characters.`;
      }
      if (
        typeof rules.max_length === "number" &&
        value.length > rules.max_length
      ) {
        return `Enter no more than ${rules.max_length} characters.`;
      }
    }
    return null;
  }

  function getScaleLabel(question: SurveyQuestion, value: string): string {
    const labels = question.validation_rules.labels;
    if (typeof labels !== "object" || labels === null || Array.isArray(labels)) {
      return value;
    }
    const label = (labels as Record<string, unknown>)[value];
    return typeof label === "string" ? label : value;
  }

  function missingQuestions(): Array<{ question: SurveyQuestion; error: string }> {
    return questions.filter(isQuestionVisible).flatMap((question) => {
      const error = validateQuestionAnswer(question, answers[question.id]);
      return error ? [{ question, error }] : [];
    });
  }

  function continueToConsent() {
    const missing = missingQuestions();
    if (missing.length) {
      const first = missing[0];
      setMessage(
        `Please complete: ${missing.map(({ question }) => question.question_text).join("; ")}`,
      );
      questionRefs.current[first.question.id]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    setMessage("");
    setStep("consent");
  }

  const renderedQuestions = questions.filter(isQuestionVisible);
  const requiredQuestions = renderedQuestions.filter(
    (question) => question.is_required,
  );
  const missingRequiredQuestions = requiredQuestions.filter((question) =>
    validateQuestionAnswer(question, answers[question.id]),
  );
  const unsupportedQuestionTypes = renderedQuestions.filter(
    (question) =>
      ![
        "short_text",
        "long_text",
        "number",
        "date",
        "multiple_choice",
        "checkboxes",
        "linear_scale",
        "dropdown",
      ].includes(question.question_type),
  );

  async function finishSubmission() {
    setLoading(true);
    setMessage("");
    try {
      const result = await submitSurvey({
        cityId,
        zoneId,
        answers: Object.entries(answers).map(([question_id, answer]) => ({
          question_id,
          answer,
        })),
        publicDisplay: publicConsent,
        futureCommunication: communicationConsent,
      });
      setConfirmation({
        publicId: result.public_participant_id,
        number: result.submission_number,
      });
      setStep("confirmation");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to submit the survey.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,#d1fae5,transparent_35%),var(--background)]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
              <span className="text-sm font-bold">CS</span>
            </div>
            <div>
              <p className="font-semibold tracking-tight">CSOD Survey</p>
              <p className="text-xs text-slate-500">Citizen science, together</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-slate-500 sm:flex">
            <LockKeyhole className="size-4" /> Your email stays private
          </div>
        </header>

        {step !== "welcome" && step !== "confirmation" && (
          <div className="mt-10 flex items-center gap-2" aria-label="Survey progress">
            {steps.map((item, index) => (
              <div key={item.key} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    index <= currentStep
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-200 text-slate-500"
                  }`}
                >
                  {index < currentStep ? <Check className="size-4" /> : index + 1}
                </div>
                <span className="hidden text-sm font-medium text-slate-600 sm:block">
                  {item.label}
                </span>
                {index < steps.length - 1 && (
                  <div className="h-px flex-1 bg-slate-200" />
                )}
              </div>
            ))}
          </div>
        )}

        <section className="flex flex-1 items-center py-12">
          {step === "welcome" && (
            <div className="grid w-full items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
                  Air quality, from your perspective
                </span>
                <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-slate-950 sm:text-7xl">
                  Help make the air we share{" "}
                  <span className="text-emerald-600">easier to understand.</span>
                </h1>
                <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
                  Share a few minutes of your experience to help researchers
                  understand air quality across India&apos;s growing cities.
                </p>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setStep("profile")}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 font-semibold text-white transition hover:bg-emerald-700"
                  >
                    Start the survey <ArrowRight className="size-4" />
                  </button>
                  <Link
                    href="/insights"
                    className="inline-flex items-center gap-2 rounded-full border border-emerald-600 bg-white px-6 py-3.5 font-semibold text-emerald-700 transition hover:bg-emerald-50"
                  >
                    Explore insights <ArrowRight className="size-4" />
                  </Link>
                </div>
                <div className="mt-8 flex flex-wrap gap-5 text-sm text-slate-500">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-emerald-600" /> Privacy-first
                  </span>
                  <span className="flex items-center gap-2">
                    <Mail className="size-4 text-emerald-600" /> Private email
                  </span>
                  <span>About 5 minutes</span>
                </div>
              </div>
              <div className="rounded-[2rem] border border-white/70 bg-white/75 p-6 shadow-2xl shadow-emerald-900/10 backdrop-blur sm:p-8">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                  Five cities, one shared story
                </p>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {cities.map((city) => (
                    <div key={city.id} className="rounded-2xl bg-slate-50 p-4">
                      <p className="font-semibold">{city.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{city.city_code}</p>
                    </div>
                  ))}
                </div>
                {!cities.length && (
                  <p className="mt-4 text-sm text-amber-700">
                    Cities are temporarily unavailable. Please try again later.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === "profile" && (
            <div className="mx-auto w-full max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                First, a little context
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight">
                Where are you taking part?
              </h2>
              <p className="mt-3 text-slate-600">
                We use your city and zone to show the right questions. Your email
                is stored privately and is not used to verify ownership.
              </p>
              <div className="mt-8 grid gap-5 sm:grid-cols-2">
                <label className="text-sm font-semibold">
                  City
                  <select
                    value={cityId}
                    onChange={(event) => void chooseCity(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Select a city</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Zone
                  <select
                    value={zoneId}
                    onChange={(event) => setZoneId(event.target.value)}
                    disabled={!cityId || loading}
                    className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">
                      {loading ? "Loading zones..." : "Select a zone"}
                    </option>
                    {zones.map((zone) => (
                      <option key={zone.id} value={zone.id}>
                        {zone.zone_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="mt-5 block text-sm font-semibold">
                Private email address
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
                <span className="mt-2 block text-xs font-normal text-slate-500">
                  Your email stays private and is not used for account recovery.
                </span>
              </label>
              {message && (
                <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                  {message}
                </p>
              )}
              <div className="mt-8 flex justify-between">
                <button
                  onClick={() => setStep("welcome")}
                  className="inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100"
                >
                  <ChevronLeft className="size-4" /> Back
                </button>
                <button
                  onClick={() => void continueFromProfile()}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {loading && <LoaderCircle className="size-4 animate-spin" />}
                  Continue to survey{" "}
                  <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          )}

          {step === "survey" && (
            <div className="mx-auto w-full max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {selectedCity?.name}
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight">
                Tell us about your experience
              </h2>
              <div className="mt-8 space-y-6">
                {renderedQuestions.map((question) => (
                  <div
                    key={question.id}
                    ref={(node) => {
                      questionRefs.current[question.id] = node;
                    }}
                    className="block rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold"
                  >
                    <span>
                      {question.question_text}
                      {question.is_required && (
                        <span className="ml-1 text-emerald-600">*</span>
                      )}
                    </span>
                    {question.question_type === "checkboxes" ? (
                      <div className="mt-3 space-y-2">
                        {question.options.map((option) => {
                          const value = String(option);
                          const selected = Array.isArray(answers[question.id])
                            ? answers[question.id].includes(value)
                            : false;
                          return (
                            <label key={value} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 font-normal">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(event) => {
                                  const current = Array.isArray(answers[question.id])
                                    ? [...answers[question.id]]
                                    : [];
                                  updateAnswer(
                                    question.id,
                                    event.target.checked
                                      ? [...current, value]
                                      : current.filter((item) => item !== value),
                                  );
                                }}
                                className="size-4 accent-emerald-600"
                              />
                              {value}
                            </label>
                          );
                        })}
                      </div>
                    ) : question.question_type === "long_text" ? (
                      <textarea
                        value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                        className="mt-3 min-h-28 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-emerald-500"
                      />
                    ) : ["multiple_choice", "dropdown"].includes(question.question_type) ? (
                      <select
                        value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                        className="mt-3 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal outline-none focus:border-emerald-500"
                      >
                        <option value="">Choose an answer</option>
                        {question.options.map((option) => (
                          <option key={String(option)} value={String(option)}>
                            {String(option)}
                          </option>
                        ))}
                      </select>
                    ) : question.question_type === "linear_scale" ? (
                      <fieldset className="mt-4">
                        <legend className="sr-only">{question.question_text}</legend>
                        <div className="flex items-center justify-between gap-4 text-xs font-medium text-slate-500">
                          <span>
                            {getScaleLabel(question, "1")}
                          </span>
                          <span>
                            {getScaleLabel(question, "10")}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
                          {question.options.map((option) => {
                            const value = String(option);
                            return (
                              <label
                                key={value}
                                className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-slate-200 p-2 font-normal has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50"
                              >
                                <input
                                  type="radio"
                                  name={`question-${question.id}`}
                                  value={value}
                                  checked={answers[question.id] === value}
                                  onChange={(event) =>
                                    updateAnswer(question.id, event.target.value)
                                  }
                                  className="size-4 accent-emerald-600"
                                  aria-label={`${value} out of 10`}
                                />
                                <span>{value}</span>
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                    ) : (
                      <input
                        type={["number", "linear_scale"].includes(question.question_type) ? "number" : "text"}
                        value={typeof answers[question.id] === "string" ? answers[question.id] : ""}
                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                        className="mt-3 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-emerald-500"
                      />
                    )}
                  </div>
                ))}
              </div>
              {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep("profile")} className="inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="size-4" /> Back</button>
                <button onClick={continueToConsent} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white hover:bg-emerald-700">Continue <ArrowRight className="size-4" /></button>
              </div>
              {process.env.NODE_ENV === "development" && (
                <aside className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-600">
                  <p className="font-semibold">Development questionnaire diagnostics</p>
                  <dl className="mt-2 grid grid-cols-2 gap-1">
                    <dt>Total loaded questions</dt><dd>{questions.length}</dd>
                    <dt>Total rendered questions</dt><dd>{renderedQuestions.length}</dd>
                    <dt>Required questions</dt><dd>{requiredQuestions.length}</dd>
                    <dt>Answered required questions</dt>
                    <dd>{requiredQuestions.length - missingRequiredQuestions.length}</dd>
                  </dl>
                  {unsupportedQuestionTypes.length > 0 && (
                    <p className="mt-2">
                      Unsupported types: {unsupportedQuestionTypes.map((question) => question.question_type).join(", ")}
                    </p>
                  )}
                  {missingRequiredQuestions.length > 0 && (
                    <div className="mt-2">
                      <p className="font-semibold">Missing required questions</p>
                      <ul className="list-inside list-disc">
                        {missingRequiredQuestions.map((question) => (
                          <li key={question.id}>{question.id}: {question.question_text}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </aside>
              )}
            </div>
          )}

          {step === "consent" && (
            <div className="mx-auto w-full max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Your choices</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight">You are in control</h2>
              <p className="mt-3 text-slate-600">Research participation is required. Public display and communication are optional.</p>
              <div className="mt-8 space-y-3">
                {[
                  ["research", "Research participation", "I agree to take part in this air-quality research.", researchConsent, setResearchConsent, true],
                  ["public", "Public display", "I agree that anonymised responses may be shared publicly.", publicConsent, setPublicConsent, false],
                  ["communication", "Future communication", "I would like to hear about related research.", communicationConsent, setCommunicationConsent, false],
                ].map(([key, title, description, checked, setter, required]) => (
                  <label key={String(key)} className="flex cursor-pointer gap-4 rounded-2xl border border-slate-200 bg-white p-5">
                    <input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="mt-1 size-5 accent-emerald-600" />
                    <span><span className="font-semibold">{String(title)}{Boolean(required) && <span className="ml-1 text-emerald-600">*</span>}</span><span className="mt-1 block text-sm text-slate-600">{String(description)}</span></span>
                  </label>
                ))}
              </div>
              {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep("survey")} className="inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="size-4" /> Back</button>
                <button onClick={() => researchConsent ? setStep("review") : setMessage("Research participation consent is required.")} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white hover:bg-emerald-700">Review answers <ArrowRight className="size-4" /></button>
              </div>
            </div>
          )}

          {step === "review" && (
            <div className="mx-auto w-full max-w-2xl">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Almost there</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight">Review your submission</h2>
              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
                <dl className="space-y-4 text-sm">
                  <div className="flex justify-between gap-6"><dt className="text-slate-500">City</dt><dd className="font-semibold">{selectedCity?.name}</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-slate-500">Email</dt><dd className="font-semibold">{email}</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-slate-500">Answers</dt><dd className="font-semibold">{Object.keys(answers).length} recorded</dd></div>
                  <div className="flex justify-between gap-6"><dt className="text-slate-500">Public display</dt><dd className="font-semibold">{publicConsent ? "Opted in" : "Not selected"}</dd></div>
                </dl>
              </div>
              {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep("consent")} className="inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="size-4" /> Back</button>
                <button onClick={() => void finishSubmission()} disabled={loading} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{loading && <LoaderCircle className="size-4 animate-spin" />} Submit survey <ArrowRight className="size-4" /></button>
              </div>
            </div>
          )}

          {step === "confirmation" && confirmation && (
            <div className="mx-auto w-full max-w-xl text-center">
              <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><Check className="size-8" /></div>
              <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Submission received</p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight">Thank you for taking part.</h2>
              <p className="mt-4 text-slate-600">Keep these details for your records.</p>
              <div className="mt-8 rounded-3xl border border-emerald-100 bg-white p-7 shadow-lg shadow-emerald-900/5">
                <p className="text-sm text-slate-500">Your public participant ID</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-emerald-700">{confirmation.publicId}</p>
                <p className="mt-6 text-sm text-slate-500">Submission number</p>
                <p className="mt-2 text-2xl font-semibold">{confirmation.number}</p>
              </div>
            </div>
          )}
        </section>
        <footer className="border-t border-slate-200/80 py-5 text-xs text-slate-500">CSOD Survey · Your participation helps build better public understanding of air quality.</footer>
      </div>
    </main>
  );
}
