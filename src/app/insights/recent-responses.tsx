"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";

import { loadPublicResponseDetail } from "@/app/actions";
import type {
  PublicResponseDetail,
  PublicResponseSummary,
} from "@/lib/insights-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ResponseDetailDialog({
  response,
  onClose,
}: {
  response: PublicResponseSummary;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<PublicResponseDetail | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      setDetail(
        await loadPublicResponseDetail(
          response.publicParticipantId,
          response.submissionNumber,
        ),
      );
    });
  }, [response, startTransition]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="response-detail-title"
      onClick={onClose}
    >
      <section
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
              Public response
            </p>
            <h2 id="response-detail-title" className="mt-2 text-2xl font-semibold">
              {response.publicParticipantId}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close response details"
            className="rounded-full p-2 hover:bg-slate-100"
          >
            <X className="size-5" />
          </button>
        </div>
        {pending ? (
          <p className="mt-8 text-sm text-slate-500">Loading response details...</p>
        ) : detail ? (
          <>
            <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">City</dt>
                <dd className="font-semibold">{detail.city}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Submitted</dt>
                <dd className="font-semibold">{formatDate(detail.submittedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Survey version</dt>
                <dd className="font-semibold">{detail.surveyVersion}</dd>
              </div>
            </dl>
            <div className="mt-6 space-y-3">
              {detail.answers.map((answer) => (
                <div key={answer.label} className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-sm font-semibold">{answer.label}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {Array.isArray(answer.answer)
                      ? answer.answer.join(", ")
                      : answer.answer}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-8 text-sm text-slate-500">
            This response is no longer available for public display.
          </p>
        )}
      </section>
    </div>
  );
}

export function RecentResponses({
  responses,
}: {
  responses: PublicResponseSummary[];
}) {
  const [selected, setSelected] = useState<PublicResponseSummary | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || responses.length < 2) return;

    let frameId = 0;
    const advance = () => {
      if (!pausedRef.current) {
        const loopWidth = scroller.scrollWidth / 2;
        scroller.scrollLeft += 0.5;
        if (loopWidth > 0 && scroller.scrollLeft >= loopWidth) {
          scroller.scrollLeft -= loopWidth;
        }
      }
      frameId = requestAnimationFrame(advance);
    };

    frameId = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frameId);
  }, [responses.length]);

  return (
    <section
      className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-labelledby="recent-responses-title"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
        Public responses
      </p>
      <h2 id="recent-responses-title" className="mt-2 text-2xl font-semibold">
        Recent responses
      </h2>
      {responses.length ? (
        <div
          ref={scrollerRef}
          className="mt-5 flex snap-x gap-4 overflow-x-auto pb-2"
          tabIndex={0}
          aria-label="Recent public responses"
          onMouseEnter={() => {
            pausedRef.current = true;
          }}
          onMouseLeave={() => {
            pausedRef.current = false;
          }}
        >
          {[...responses, ...responses].map((response, index) => (
            <button
              key={`${response.publicParticipantId}-${response.submissionNumber}-${index}`}
              type="button"
              onClick={() => setSelected(response)}
              className="w-72 shrink-0 snap-start rounded-2xl border border-slate-200 p-5 text-left transition hover:-translate-y-1 hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <p className="font-semibold text-emerald-700">
                {response.publicParticipantId}
              </p>
              <p className="mt-3 text-sm text-slate-700">{response.city}</p>
              <p className="mt-1 text-xs text-slate-500">
                {formatDate(response.submittedAt)}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          No public responses are available yet.
        </p>
      )}
      {selected && (
        <ResponseDetailDialog
          response={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
