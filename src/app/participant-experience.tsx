"use client";

import { useEffect, useState } from "react";
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
  checkParticipantSession,
  loadQuestions,
  loadZones,
  requestVerification,
  submitSurvey,
} from "@/app/actions";
import type { City, SurveyQuestion, Zone } from "@/lib/survey-data";

type Props = { cities: City[]; verificationState?: string };
type Step = "welcome" | "profile" | "survey" | "consent" | "review" | "confirmation";

const steps: Array<{ key: Step; label: string }> = [
  { key: "profile", label: "About you" },
  { key: "survey", label: "Survey" },
  { key: "consent", label: "Choices" },
  { key: "review", label: "Review" },
];

export default function ParticipantExperience({
  cities,
  verificationState,
}: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [cityId, setCityId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [email, setEmail] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [researchConsent, setResearchConsent] = useState(false);
  const [publicConsent, setPublicConsent] = useState(false);
  const [communicationConsent, setCommunicationConsent] = useState(false);
  const [verificationSent, setVerificationSent] = useState(verificationState === "1");
  const [verified, setVerified] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    publicId: string;
    number: number;
  }>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const selectedCity = cities.find((city) => city.id === cityId);
  const currentStep = steps.findIndex(({ key }) => key === step);

  useEffect(() => {
    if (verificationState !== "1") return;
    void checkParticipantSession().then((sessionIsValid) => {
      setVerified(sessionIsValid);
      setStep("profile");
      setMessage(
        sessionIsValid
          ? "Email verified. You can continue your survey."
          : "This verification link is no longer active.",
      );
    });
  }, [verificationState]);

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
      if (!verified) {
        if (!verificationSent) {
          await requestVerification(email, cityId);
          setVerificationSent(true);
          setMessage("Check your inbox for a one-time verification link.");
          return;
        }
        const sessionIsValid = await checkParticipantSession();
        if (!sessionIsValid) {
          setMessage("Verify your email using the link we sent before continuing.");
          return;
        }
        setVerified(true);
      }
      setQuestions(await loadQuestions(cityId));
      setStep("survey");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to continue.");
    } finally {
      setLoading(false);
    }
  }

  function updateAnswer(questionId: string, value: string) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  }

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

  const canReview =
    researchConsent &&
    questions.every(
      (question) => !question.is_required || Boolean(answers[question.id]),
    );

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
                <button
                  onClick={() => setStep("profile")}
                  className="mt-9 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 font-semibold text-white transition hover:bg-emerald-700"
                >
                  Start the survey <ArrowRight className="size-4" />
                </button>
                <div className="mt-8 flex flex-wrap gap-5 text-sm text-slate-500">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-emerald-600" /> Privacy-first
                  </span>
                  <span className="flex items-center gap-2">
                    <Mail className="size-4 text-emerald-600" /> Verified email
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
                is used for one-time verification and remains private.
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
                  We&apos;ll send a single-use verification link.
                </span>
              </label>
              {verificationSent && !verified && (
                <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
                  Verification email sent. Open the link, then return here and
                  continue.
                </p>
              )}
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
                  {verificationSent && !verified ? "I verified my email" : "Verify email"}{" "}
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
                {questions.map((question) => (
                  <label
                    key={question.id}
                    className="block rounded-2xl border border-slate-200 bg-white p-5 text-sm font-semibold"
                  >
                    <span>
                      {question.question_text}
                      {question.is_required && (
                        <span className="ml-1 text-emerald-600">*</span>
                      )}
                    </span>
                    {question.question_type === "long_text" ? (
                      <textarea
                        value={answers[question.id] ?? ""}
                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                        className="mt-3 min-h-28 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-emerald-500"
                      />
                    ) : question.options.length ? (
                      <select
                        value={answers[question.id] ?? ""}
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
                    ) : (
                      <input
                        value={answers[question.id] ?? ""}
                        onChange={(event) => updateAnswer(question.id, event.target.value)}
                        className="mt-3 w-full rounded-xl border border-slate-200 p-3 font-normal outline-none focus:border-emerald-500"
                      />
                    )}
                  </label>
                ))}
              </div>
              {message && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{message}</p>}
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep("profile")} className="inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100"><ChevronLeft className="size-4" /> Back</button>
                <button onClick={() => canReview ? setStep("consent") : setMessage("Please answer every required question.")} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white hover:bg-emerald-700">Continue <ArrowRight className="size-4" /></button>
              </div>
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
