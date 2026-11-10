"use client";

export default function InsightsError() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-slate-950">
      <section className="max-w-lg rounded-3xl border border-amber-200 bg-white p-8 shadow-sm dark:border-amber-950 dark:bg-slate-900">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">
          Temporarily unavailable
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Insights could not be loaded.</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          Please try again later.
        </p>
      </section>
    </main>
  );
}
