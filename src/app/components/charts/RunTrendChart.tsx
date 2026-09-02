"use client";

// ============================================================
// EnduroLab - Synced Run Trends
// ============================================================

import React from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RunActivity } from "@/lib/activities/models";
import { MarathonPlan, formatPace } from "@/lib/training/models";

interface RunTrendChartProps {
  plan: MarathonPlan;
  activities: RunActivity[];
}

export default function RunTrendChart({ plan, activities }: RunTrendChartProps): React.ReactNode {
  const data = plan.weeks.map((week) => {
    const start = week.startDate.slice(0, 10);
    const end = week.endDate.slice(0, 10);
    const runs = activities.filter((activity) => activity.localDate >= start && activity.localDate <= end);
    const timedRuns = runs.filter((activity) => activity.averagePaceMinutesPerMile !== null);
    const hrRuns = runs.filter((activity) => activity.averageHeartRate !== null);
    const pace = timedRuns.length > 0
      ? timedRuns.reduce((sum, activity) => sum + (activity.averagePaceMinutesPerMile ?? 0) * activity.distanceMiles, 0) /
        timedRuns.reduce((sum, activity) => sum + activity.distanceMiles, 0)
      : undefined;
    const heartRate = hrRuns.length > 0
      ? Math.round(hrRuns.reduce((sum, activity) => sum + (activity.averageHeartRate ?? 0), 0) / hrRuns.length)
      : undefined;
    return { week: `W${week.weekNumber}`, pace, heartRate, runs: runs.length };
  });

  if (activities.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900">Run Performance Trends</h3>
        <p className="mt-2 text-sm text-gray-500">Connect and sync Garmin to see weekly pace and heart-rate trends.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-1 text-lg font-semibold text-gray-900">Run Performance Trends</h3>
      <p className="mb-4 text-xs text-gray-500">Distance-weighted average pace and mean activity heart rate.</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="week" tick={{ fontSize: 12, fill: "#9ca3af" }} />
            <YAxis yAxisId="pace" tick={{ fontSize: 12, fill: "#9ca3af" }} tickFormatter={(value: number) => formatPace(value)} reversed domain={["dataMin - 0.25", "dataMax + 0.25"]} />
            <YAxis yAxisId="hr" orientation="right" tick={{ fontSize: 12, fill: "#9ca3af" }} domain={["dataMin - 5", "dataMax + 5"]} />
            <Tooltip formatter={(value: number, name: string) => name === "Pace" ? [`${formatPace(value)}/mi`, name] : [`${value} bpm`, name]} />
            <Legend verticalAlign="top" height={28} />
            <Line yAxisId="pace" type="monotone" dataKey="pace" name="Pace" stroke="#0369a1" strokeWidth={2} connectNulls={false} />
            <Line yAxisId="hr" type="monotone" dataKey="heartRate" name="Heart rate" stroke="#e11d48" strokeWidth={2} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
