"use client";

import {
  CartesianGrid,
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  DailyActivityCategorySummary,
  DailyScheduleCoverage,
  InsightMetric,
  PublicInsights,
} from "@/lib/insights-data";

function DailyActivityCharts({
  coverage,
  activities,
  locations,
  isSuppressed,
}: {
  coverage: DailyScheduleCoverage;
  activities: DailyActivityCategorySummary[];
  locations: DailyActivityCategorySummary[];
  isSuppressed: boolean;
}) {
  if (coverage.scheduleCount === 0) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">Daily Activity Patterns</h3>
        <p className="mt-4 text-sm text-slate-500">No daily schedule data is available.</p>
      </section>
    );
  }

  if (isSuppressed) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-semibold text-slate-900">Daily Activity Patterns</h3>
          <span className="text-xs text-slate-500">n={coverage.scheduleCount}</span>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Breakdown suppressed: fewer than 5 valid daily schedules (n={coverage.scheduleCount}).
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">Daily Activity & Exposure Patterns</h3>
        <p className="mt-1 text-sm text-slate-500">
          Aggregated daily activity schedules reported by participants (n={coverage.scheduleCount}).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Recorded schedules</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{coverage.scheduleCount}</p>
          <p className="mt-1 text-xs text-slate-400">Eligible participant schedules</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Total recorded time</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{coverage.totalRecordedHours} hrs</p>
          <p className="mt-1 text-xs text-slate-400">Across all schedules</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Average time per schedule</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{coverage.averageRecordedHours} hrs</p>
          <p className="mt-1 text-xs text-slate-400">Daily recorded activity</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Average unallocated time</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{coverage.averageUnallocatedHours} hrs</p>
          <p className="mt-1 text-xs text-slate-400">Remaining daily buffer</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h4 className="font-semibold">Average daily time by activity</h4>
            <span className="text-xs text-slate-500">n={coverage.scheduleCount}</span>
          </div>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activities} layout="vertical" margin={{ top: 5, right: 12, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value} hrs (${item?.payload?.respondentCount} respondents)`,
                    "Average daily time",
                  ]}
                />
                <Bar dataKey="averageHours" name="Average hours" fill="#059669" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h4 className="font-semibold">Average daily time by location</h4>
            <span className="text-xs text-slate-500">n={coverage.scheduleCount}</span>
          </div>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={locations} layout="vertical" margin={{ top: 5, right: 12, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value} hrs (${item?.payload?.respondentCount} respondents)`,
                    "Average daily time",
                  ]}
                />
                <Bar dataKey="averageHours" name="Average hours" fill="#0e7490" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h4 className="font-semibold">Activity participation (respondents)</h4>
            <span className="text-xs text-slate-500">n={coverage.scheduleCount}</span>
          </div>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activities} layout="vertical" margin={{ top: 5, right: 12, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value} respondents (${item?.payload?.respondentPercentage}%)`,
                    "Reporting participants",
                  ]}
                />
                <Bar dataKey="respondentCount" name="Respondents" fill="#059669" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <h4 className="font-semibold">Location participation (respondents)</h4>
            <span className="text-xs text-slate-500">n={coverage.scheduleCount}</span>
          </div>
          <div className="mt-5 h-64 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={locations} layout="vertical" margin={{ top: 5, right: 12, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="category" width={130} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, _name, item) => [
                    `${value} respondents (${item?.payload?.respondentPercentage}%)`,
                    "Reporting participants",
                  ]}
                />
                <Bar dataKey="respondentCount" name="Respondents" fill="#0e7490" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

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
          {metric.responseType === "line" ? (
            <LineChart data={metric.distribution} margin={{ top: 5, right: 12, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, _name, item) => [`${value} (${Number(item?.payload?.percentage ?? 0).toFixed(1)}%)`, "Responses"]} />
              <Line type="monotone" dataKey="count" name="Responses" stroke="#059669" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          ) : (
            <BarChart data={metric.distribution} layout="vertical" margin={{ top: 5, right: 12, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.12} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value, _name, item) => [`${value} (${Number(item?.payload?.percentage ?? 0).toFixed(1)}%)`, "Selections"]} />
              <Bar dataKey="count" name="Selections" fill="#059669" radius={[0, 6, 6, 0]} />
            </BarChart>
          )}
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
  const metric = (key: InsightMetric["key"]): InsightMetric => insights.metrics.find((item) => item.key === key) ?? {
    key,
    question: key,
    sampleSize: 0,
    responseType: "bar",
    selectionCount: 0,
    distribution: [],
  };
  return (
    <div className="space-y-8">
      <TrendChart insights={insights} />
      {insights.dailyActivity && (
        <DailyActivityCharts
          coverage={insights.dailyActivity.coverage}
          activities={insights.dailyActivity.activities}
          locations={insights.dailyActivity.locations}
          isSuppressed={insights.dailyActivity.isSuppressed}
        />
      )}
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
