"use client";

import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import type { InsightMetric, PublicInsights } from "@/lib/insights-data";

const colors = ["#059669", "#0f766e", "#0e7490", "#2563eb", "#7c3aed", "#c026d3", "#db2777", "#e11d48", "#ea580c", "#ca8a04"];
const ratingKeys = new Set(["perceived_air_quality", "public_transport_awareness"]);

function ChartCard({ title, metric }: { title: string; metric: InsightMetric }) {
  if (metric.sampleSize < 5) {
    return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-4 text-sm text-slate-500">Breakdown suppressed: fewer than 5 valid answers (n={metric.sampleSize}).</p>
    </section>;
  }
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4"><h3 className="font-semibold">{title}</h3><span className="text-xs text-slate-500">n={metric.sampleSize}</span></div>
    <div className="mt-5 h-72 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={metric.distribution} layout="vertical" margin={{ top: 5, right: 12, left: 12, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="label" width={125} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, _name, item) => [`${value} (${Number(item?.payload?.percentage ?? 0).toFixed(1)}%)`, "Responses"]} />
          <Bar dataKey="count" radius={[0, 6, 6, 0]}>
            {metric.distribution.map((entry, index) => <Cell key={entry.key} fill={colors[index % colors.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

function RatingChart({ title, metric }: { title: string; metric: InsightMetric }) {
  if (metric.sampleSize < 5) return <ChartCard title={title} metric={metric} />;
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4"><h3 className="font-semibold">{title}</h3><span className="text-xs text-slate-500">n={metric.sampleSize}</span></div>
    <div className="mt-5 h-64 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={metric.distribution} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value) => [value, "Responses"]} />
          <Line type="monotone" dataKey="count" name="Responses" stroke="#059669" strokeWidth={3} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </section>;
}

function TrendChart({ insights }: { insights: PublicInsights }) {
  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-4"><h3 className="font-semibold">Submissions over time</h3><span className="text-xs text-slate-500">n={insights.responseCount}</span></div>
    {insights.responseTrend.length ? <div className="mt-5 h-64 min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={insights.responseTrend} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip /><Line type="monotone" dataKey="count" name="Responses" stroke="#0e7490" strokeWidth={3} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div> : <p className="mt-4 text-sm text-slate-500">No date data is available.</p>}
  </section>;
}

export function InsightsCharts({ insights }: { insights: PublicInsights }) {
  const metric = (key: InsightMetric["key"]) => insights.metrics.find((item) => item.key === key) ?? { key, question: key, sampleSize: 0, distribution: [] };
  const render = (key: InsightMetric["key"], title: string) => ratingKeys.has(key) ? <RatingChart key={key} title={title} metric={metric(key)} /> : <ChartCard key={key} title={title} metric={metric(key)} />;
  return <div className="space-y-6">
    <TrendChart insights={insights} />
    <div className="grid gap-6 lg:grid-cols-2">
      {render("perceived_air_quality", "Perceived air-quality rating (1–10)")}
      {render("public_transport_awareness", "Public-transport awareness (1–10)")}
      {render("observed_pollution_sources", "Commonly reported pollution sources")}
      {render("main_transport_mode", "Main transportation modes")}
      {render("traffic_exposure", "Traffic exposure")}
      {render("construction_activity", "Construction exposure")}
      {render("waste_burning", "Waste-burning exposure")}
      {render("aqi_awareness", "AQI awareness")}
      {render("improvement_priority", "Pollution improvement priorities")}
    </div>
  </div>;
}
