"use client";

import { useEffect, useState, useTransition } from "react";
import { X } from "lucide-react";
import { loadPublicResponseDetail } from "@/app/actions";
import type { PublicResponseDetail, PublicResponseSummary } from "@/lib/insights-data";

function displayDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function ResponseCard({ response, onSelect, decorative = false }: { response: PublicResponseSummary; onSelect: (response: PublicResponseSummary) => void; decorative?: boolean }) {
  if (decorative) return <div className="w-72 shrink-0 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm"><p className="font-semibold text-emerald-700">{response.publicParticipantId}</p><p className="mt-3 text-sm text-slate-700">{response.city}</p><p className="mt-1 text-xs text-slate-500">{displayDate(response.submittedAt)}</p></div>;
  return <button type="button" onClick={() => onSelect(response)} className="w-72 shrink-0 rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-1 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
    <p className="font-semibold text-emerald-700">{response.publicParticipantId}</p>
    <p className="mt-3 text-sm text-slate-700">{response.city}</p>
    <p className="mt-1 text-xs text-slate-500">{displayDate(response.submittedAt)}</p>
  </button>;
}

function DetailDialog({ response, onClose }: { response: PublicResponseSummary; onClose: () => void }) {
  const [detail, setDetail] = useState<PublicResponseDetail | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    startTransition(async () => setDetail(await loadPublicResponseDetail(response.publicParticipantId, response.submissionNumber)));
  }, [response, startTransition]);
  return <div role="dialog" aria-modal="true" aria-labelledby="response-detail-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={onClose}>
    <section className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Public response</p><h2 id="response-detail-title" className="mt-2 text-2xl font-semibold">{response.publicParticipantId}</h2></div><button type="button" onClick={onClose} aria-label="Close response details" className="rounded-full p-2 hover:bg-slate-100"><X className="size-5" /></button></div>
      {pending ? <p className="mt-8 text-sm text-slate-500">Loading approved public answers…</p> : detail ? <><dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">City</dt><dd className="font-semibold">{detail.city}</dd></div><div><dt className="text-slate-500">Submitted</dt><dd className="font-semibold">{displayDate(detail.submittedAt)}</dd></div><div><dt className="text-slate-500">Survey version</dt><dd className="font-semibold">{detail.surveyVersion}</dd></div></dl><div className="mt-6 space-y-3">{detail.answers.map((answer) => <div key={answer.label} className="rounded-2xl bg-slate-50 p-4"><p className="text-sm font-semibold">{answer.label}</p><p className="mt-1 text-sm text-slate-600">{Array.isArray(answer.answer) ? answer.answer.join(", ") : answer.answer}</p></div>)}</div></> : <p className="mt-8 text-sm text-slate-500">This response is no longer available for public display.</p>}
    </section>
  </div>;
}

export function RecentResponses({ responses }: { responses: PublicResponseSummary[] }) {
  const [selected, setSelected] = useState<PublicResponseSummary | null>(null);
  if (!responses.length) return <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xl font-semibold">Recent public responses</h2><p className="mt-2 text-sm text-slate-500">No consented public responses are available yet.</p></section>;
  return <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="recent-responses-title">
    <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Consent-aware feed</p><h2 id="recent-responses-title" className="mt-2 text-2xl font-semibold">Recent public responses</h2></div><p className="text-xs text-slate-500">Select a card for approved structured answers</p></div>
    <div className="mt-5 overflow-x-auto pb-2" tabIndex={0} aria-label="Recent public responses, horizontally scrollable"><div className="marquee-track flex w-max gap-4">
      {responses.map((response) => <ResponseCard key={`${response.publicParticipantId}-${response.submissionNumber}`} response={response} onSelect={setSelected} />)}
      {responses.map((response) => <div key={`copy-${response.publicParticipantId}-${response.submissionNumber}`} aria-hidden="true"><ResponseCard response={response} onSelect={setSelected} decorative /></div>)}
    </div></div>
    {selected && <DetailDialog response={selected} onClose={() => setSelected(null)} />}
  </section>;
}
