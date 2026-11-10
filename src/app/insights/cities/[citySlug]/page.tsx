import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { connection } from "next/server";

import { InsightsCharts } from "@/app/insights/insights-charts";
import { getPublicCityInsights } from "@/lib/insights-data";

export async function generateStaticParams() {
  return ["bhubaneswar", "mumbai", "bengaluru", "jamshedpur", "patna"].map((citySlug) => ({ citySlug }));
}

export default async function CityInsightsPage({
  params,
}: {
  params: Promise<{ citySlug: string }>;
}) {
  await connection();
  const { city, insights } = await getPublicCityInsights((await params).citySlug);
  if (!city) return <NotFoundCity />;
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,#d1fae5,transparent_35%),var(--background)]">
      <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between"><Link href="/insights" className="font-semibold tracking-tight">CSOD Survey insights</Link><Link href="/" className="text-sm font-semibold text-emerald-700">Take the survey</Link></header>
        <section className="py-16"><Link href="/insights" className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><ArrowLeft className="size-4" /> All insights</Link><p className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">City insights</p><h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">{city.name}</h1><p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">Aggregated public responses for survey version {insights.surveyVersion}. Individual records and free-text answers are never shown.</p></section>
        {!city.eligible ? <section className="rounded-3xl border border-amber-200 bg-amber-50 p-8 dark:border-amber-950 dark:bg-amber-950/30"><h2 className="text-2xl font-semibold">City breakdown is protected</h2><p className="mt-3 max-w-xl text-slate-700 dark:text-slate-300">At least 10 eligible public responses are required before city-level distributions are presented. Current eligible response count: {city.responseCount}.</p></section> : <><div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div><p className="text-sm text-slate-500">Eligible public responses</p><p className="mt-1 text-3xl font-semibold">{city.responseCount}</p></div><Link href="/insights" className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700">Compare all cities <ArrowRight className="size-4" /></Link></div><div className="mt-8"><InsightsCharts insights={{ ...insights, responseCount: city.responseCount, cities: [city], metrics: city.metrics, participatingCityCount: 1 }} /></div></>}
        <p className="mt-12 text-center text-sm text-slate-500">Voluntary citizen reports only. Perceived air quality is not an official AQI reading.</p>
      </div>
    </main>
  );
}

function NotFoundCity() { return <main className="flex min-h-screen items-center justify-center px-6"><section><h1 className="text-3xl font-semibold">City not found</h1><Link href="/insights" className="mt-4 inline-block text-emerald-700">Return to insights</Link></section></main>; }
