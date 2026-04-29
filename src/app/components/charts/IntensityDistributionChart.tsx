import React from "react";
// ============================================================
// EnduroLab — Intensity Distribution Chart
// ============================================================
// Stacked bar chart showing the distribution of easy,
// threshold, marathon-pace, and VO2 mileage per week.
// ============================================================

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MarathonPlan } from "@/lib/training/models";

interface IntensityDistributionChartProps {
  plan: MarathonPlan;
}

function formatWeekEndDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export default function IntensityDistributionChart({ plan }: IntensityDistributionChartProps) {
  const data = plan.weeks.map((week) => ({
    week: week.weekNumber,
    weekLabel: `W${week.weekNumber} · ${formatWeekEndDate(week.endDate)}`,
    weekEndDate: formatWeekEndDate(week.endDate),
    easy: Math.round(week.intensityDistribution.easy),
    threshold: Math.round(week.intensityDistribution.threshold),
    marathon: Math.round(week.intensityDistribution.marathon),
    vo2: Math.round(week.intensityDistribution.vo2),
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Intensity Distribution</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="weekLabel"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 13 }}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as { week: number; weekEndDate: string } | undefined;
                return point ? `Week ${point.week} ending ${point.weekEndDate}` : "";
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="easy" stackId="a" fill="#22c55e" name="Easy" />
            <Bar dataKey="threshold" stackId="a" fill="#f59e0b" name="Threshold" />
            <Bar dataKey="marathon" stackId="a" fill="#3b82f6" name="Marathon Pace" />
            <Bar dataKey="vo2" stackId="a" fill="#ef4444" name="VO2" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
