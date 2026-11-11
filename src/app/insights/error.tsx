"use client";

export default function InsightsError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="max-w-lg rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
          Temporarily unavailable
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Insights could not be loaded.</h1>
        <p className="mt-3 text-slate-600">
          Please try again later.
        </p>
      </section>
    </main>
  );
}
