import type { PublicResponseSummary } from "@/lib/insights-data";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function RecentResponses({
  responses,
}: {
  responses: PublicResponseSummary[];
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="recent-responses-title">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Public responses</p>
      <h2 id="recent-responses-title" className="mt-2 text-2xl font-semibold">Recent responses</h2>
      {responses.length ? (
        <div className="mt-5 flex snap-x gap-4 overflow-x-auto pb-2" tabIndex={0} aria-label="Recent public responses">
          {responses.map((response) => (
            <article key={`${response.publicParticipantId}-${response.submittedAt}`} className="w-72 shrink-0 snap-start rounded-2xl border border-slate-200 p-5">
              <p className="font-semibold text-emerald-700">{response.publicParticipantId}</p>
              <p className="mt-3 text-sm text-slate-700">{response.city}</p>
              <p className="mt-1 text-xs text-slate-500">{formatDate(response.submittedAt)}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">No public responses are available yet.</p>
      )}
    </section>
  );
}
