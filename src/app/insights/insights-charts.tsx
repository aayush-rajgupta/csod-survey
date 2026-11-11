"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { InsightMetric, PublicInsights } from "@/lib/insights-data";

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
          <LineChart data={metric.distribution} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={metric.distribution.length > 6 ? -35 : 0} textAnchor={metric.distribution.length > 6 ? "end" : "middle"} height={metric.distribution.length > 6 ? 55 : 30} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value, _name, item) => [`${value} (${Number(item?.payload?.percentage ?? 0).toFixed(1)}%)`, "Responses"]} />
            <Line type="monotone" dataKey="count" name="Responses" stroke="#059669" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
          </LineChart>
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
            <LineChart data={insights.responseTrend} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="count" name="Responses" stroke="#0e7490" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="mt-4 text-sm text-slate-500">No date data is available.</p>}
    </section>
  );
}

export function InsightsCharts({ insights }: { insights: PublicInsights }) {
  const metric = (key: InsightMetric["key"]) => insights.metrics.find((item) => item.key === key) ?? { key, question: key, sampleSize: 0, distribution: [] };
  return (
    <div className="space-y-6">
      <TrendChart insights={insights} />
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
