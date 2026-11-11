"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InsightDistribution, InsightMetric, PublicInsights } from "@/lib/insights-data";

const colors = ["#059669", "#0f766e", "#0e7490", "#2563eb", "#7c3aed", "#c026d3", "#db2777", "#e11d48", "#ea580c", "#ca8a04"];

function ChartCard({ title, metric }: { title: string; metric: InsightMetric }) {
  if (metric.sampleSize < 5) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-4 text-sm text-slate-500">Breakdown suppressed: fewer than 5 valid answers (n={metric.sampleSize}).</p>
      </section>
    );
  }
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-slate-500">n={metric.sampleSize}</span>
      </div>
      <div className="mt-5 h-64 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={metric.distribution} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={metric.distribution.length > 6 ? -35 : 0} textAnchor={metric.distribution.length > 6 ? "end" : "middle"} height={metric.distribution.length > 6 ? 55 : 30} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, _name, item) => [`${value} (${Number(item?.payload?.percentage ?? 0).toFixed(1)}%)`, "Responses"]} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#059669">
              {metric.distribution.map((entry, index) => <Cell key={entry.key} fill={colors[index % colors.length]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function TrendChart({ insights }: { insights: PublicInsights }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-semibold">Responses over time</h3>
        <span className="text-xs text-slate-500">n={insights.responseCount}</span>
      </div>
      {insights.responseTrend.length ? (
        <div className="mt-5 h-64 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={insights.responseTrend} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Responses" fill="#0e7490" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="mt-4 text-sm text-slate-500">No date data is available.</p>}
    </section>
  );
}

function Explorer({ insights }: { insights: PublicInsights }) {
  const [citySlug, setCitySlug] = useState("all");
  const [metricKey, setMetricKey] = useState<InsightMetric["key"]>("perceived_air_quality");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const metric = useMemo(() => {
    if (citySlug === "all" && (fromDate || toDate)) {
      const selectedDates = insights.availableDates.filter(
        (date) => (!fromDate || date >= fromDate) && (!toDate || date <= toDate),
      );
      const selected = selectedDates
        .flatMap((date) => insights.dailyMetrics[date]?.filter((item) => item.key === metricKey) ?? []);
      if (!selected.length) return undefined;
      const distribution = new Map<string, InsightDistribution>();
      for (const item of selected) {
        for (const entry of item.distribution) {
          const current = distribution.get(entry.key) ?? { ...entry, count: 0, percentage: 0 };
          current.count += entry.count;
          distribution.set(entry.key, current);
        }
      }
      const sampleSize = selected.reduce((sum, item) => sum + item.sampleSize, 0);
      return {
        ...selected[0],
        sampleSize,
        distribution: [...distribution.values()].map((entry) => ({
          ...entry,
          percentage: sampleSize ? (entry.count / sampleSize) * 100 : 0,
        })),
      };
    }
    if (citySlug === "all") return insights.metrics.find((item) => item.key === metricKey);
    return insights.cities.find((city) => city.slug === citySlug)?.metrics.find((item) => item.key === metricKey);
  }, [citySlug, fromDate, insights, metricKey, toDate]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Response explorer</p><h2 className="mt-2 text-2xl font-semibold">Explore distributions</h2></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium">City<select value={citySlug} onChange={(event) => setCitySlug(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2"><option value="all">All cities</option>{insights.cities.filter((city) => city.eligible).map((city) => <option key={city.slug} value={city.slug}>{city.name}</option>)}</select></label>
          <label className="text-sm font-medium">Question<select value={metricKey} onChange={(event) => setMetricKey(event.target.value as InsightMetric["key"])} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2">{insights.metrics.map((item) => <option key={item.key} value={item.key}>{item.question}</option>)}</select></label>
          <label className="text-sm font-medium">From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} disabled={citySlug !== "all"} min={insights.availableDates[0]} max={insights.availableDates.at(-1)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" /></label>
          <label className="text-sm font-medium">To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} disabled={citySlug !== "all"} min={insights.availableDates[0]} max={insights.availableDates.at(-1)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2" /></label>
        </div>
      </div>
      {metric ? <ChartCard title={metric.question} metric={metric} /> : <p className="mt-5 text-sm text-slate-500">Choose a breakdown.</p>}
    </section>
  );
}

export function InsightsCharts({ insights }: { insights: PublicInsights }) {
  const metric = (key: InsightMetric["key"]) => insights.metrics.find((item) => item.key === key) ?? { key, question: key, sampleSize: 0, distribution: [] };
  return (
    <div className="space-y-6">
      <TrendChart insights={insights} />
      <Explorer insights={insights} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Commonly reported pollution sources" metric={metric("observed_pollution_sources")} />
        <ChartCard title="Main transportation modes" metric={metric("main_transport_mode")} />
        <ChartCard title="Traffic exposure" metric={metric("traffic_exposure")} />
        <ChartCard title="Construction exposure" metric={metric("construction_activity")} />
        <ChartCard title="Waste-burning exposure" metric={metric("waste_burning")} />
        <ChartCard title="AQI awareness" metric={metric("aqi_awareness")} />
        <ChartCard title="Pollution improvement priorities" metric={metric("improvement_priority")} />
        <ChartCard title="Perceived air quality" metric={metric("perceived_air_quality")} />
      </div>
    </div>
  );
}
