import Link from "next/link";
import { ArrowRight, BarChart3, MapPin, ShieldCheck } from "lucide-react";
import { connection } from "next/server";

import { InsightsCharts } from "@/app/insights/insights-charts";
import { RecentResponses } from "@/app/insights/recent-responses";
import { getPublicInsights } from "@/lib/insights-data";

export const metadata = { title: "Public insights" };

function Kpi({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs text-slate-500">{detail}</p></div>;
}

export default async function InsightsPage() {
  await connection();
  let insights;
  try { insights = await getPublicInsights(); } catch { return <InsightsError />; }
  const hasData = insights.responseCount > 0;
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,#d1fae5,transparent_35%),var(--background)]">
      <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between"><Link href="/" className="font-semibold tracking-tight">CSOD Survey</Link><nav className="flex items-center gap-4 text-sm"><Link href="/" className="text-slate-500 hover:text-emerald-700">Take the survey</Link><Link href="/insights" className="font-semibold text-emerald-700">Insights</Link></nav></header>
        <section className="py-16"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">Public insights</p><h1 className="mt-4 max-w-4xl text-5xl font-semibold leading-[1.05] tracking-tight sm:text-7xl">What residents are reporting about air quality.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">Explore descriptive, consent-aware aggregates from voluntary citizen reports across five cities. This is not an official AQI measurement.</p></section>
        {!hasData ? <EmptyState responseCount={insights.responseCount} /> : <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Kpi label="Eligible public responses" value={insights.responseCount.toLocaleString()} detail="Combined eligible survey responses" /><Kpi label="Participating cities" value={String(insights.participatingCityCount)} detail="With at least one eligible response" /><Kpi label="Average perceived air quality" value={insights.averageAirQuality?.toFixed(1) ?? "—"} detail="Valid configured rating answers" /><Kpi label="Average transport awareness" value={insights.averageTransportAwareness?.toFixed(1) ?? "—"} detail="Valid configured rating answers" /></div>
          <section className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-5">{insights.cities.map((city) => <Link key={city.slug} href={`/insights/cities/${city.slug}`} className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-emerald-300"><div className="flex items-center justify-between"><MapPin className="size-5 text-emerald-600" /><ArrowRight className="size-4 text-slate-400 transition group-hover:translate-x-1" /></div><h2 className="mt-5 font-semibold">{city.name}</h2><p className="mt-1 text-sm text-slate-500">{city.eligible ? `${city.responseCount} public responses` : "City breakdown requires n≥1"}</p></Link>)}</section>
          <div className="mt-8"><InsightsCharts insights={insights} /></div>
          <div className="mt-8"><RecentResponses responses={insights.recentResponses} /></div>
        </>}
        <Methodology />
      </div>
    </main>
  );
}

function Methodology() { return <section className="mt-16 grid gap-4 rounded-3xl border border-emerald-100 bg-emerald-50 p-6 text-sm leading-7 text-slate-700 sm:grid-cols-3"><div><ShieldCheck className="size-5 text-emerald-700" /><p className="mt-3 font-semibold">Consent-aware</p><p className="mt-1">Only approved responses with a latest granted public-display consent event are included.</p></div><div><BarChart3 className="size-5 text-emerald-700" /><p className="mt-3 font-semibold">Descriptive only</p><p className="mt-1">Results represent submitted responses, not the entire city population. Perceived air quality is not an official AQI reading.</p></div><div><ShieldCheck className="size-5 text-emerald-700" /><p className="mt-3 font-semibold">Privacy protected</p><p className="mt-1">No participant identities, zones, or free-text answers are exposed. Small breakdowns are suppressed.</p></div></section>; }
function EmptyState({ responseCount }: { responseCount: number }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-700">
        Eligible public responses: {responseCount}
      </p>
      <h2 className="mt-3 text-2xl font-semibold">
        No eligible public responses are available yet
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-slate-500">
        Responses appear here only after approved moderation, public visibility,
        and a latest granted public-display consent event. City-level breakdowns
        require at least 1 eligible response; smaller category breakdowns are
        suppressed.
      </p>
    </section>
  );
}
function InsightsError() { return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><section className="max-w-lg rounded-3xl border border-amber-200 bg-white p-8 shadow-sm"><p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Temporarily unavailable</p><h1 className="mt-3 text-3xl font-semibold">We couldn&apos;t load public insights.</h1><p className="mt-3 text-slate-600">Please try again later.</p></section></main>; }
