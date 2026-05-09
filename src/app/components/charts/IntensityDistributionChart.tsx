import React from "react";
// ============================================================
// EnduroLab — Intensity Distribution Chart
// ============================================================
// Stacked bar chart showing the distribution of easy,
// threshold, marathon-pace, and VO2 mileage per week.
// ============================================================

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList } from "recharts";
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
  const data = plan.weeks.map((week) => {
    const easyMiles = Math.round(week.intensityDistribution.easy);
    const thresholdMiles = Math.round(week.intensityDistribution.threshold);
    const marathonMiles = Math.round(week.intensityDistribution.marathon);
    const vo2Miles = Math.round(week.intensityDistribution.vo2);
    const totalMiles = Math.max(1, easyMiles + thresholdMiles + marathonMiles + vo2Miles);

    return {
      week: week.weekNumber,
      weekLabel: `W${week.weekNumber} · ${formatWeekEndDate(week.endDate)}`,
      weekEndDate: formatWeekEndDate(week.endDate),
      easyMiles,
      thresholdMiles,
      marathonMiles,
      vo2Miles,
      easy: Math.round((easyMiles / totalMiles) * 100),
      threshold: Math.round((thresholdMiles / totalMiles) * 100),
      marathon: Math.round((marathonMiles / totalMiles) * 100),
      vo2: Math.round((vo2Miles / totalMiles) * 100),
    };
  });

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
              domain={[0, 100]}
              tickFormatter={(value) => `${value}%`}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 13 }}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as { week: number; weekEndDate: string } | undefined;
                return point ? `Week ${point.week} ending ${point.weekEndDate}` : "";
              }}
              formatter={(value, name, item) => {
                const key = String(item.dataKey);
                const milesKey = `${key}Miles` as "easyMiles" | "thresholdMiles" | "marathonMiles" | "vo2Miles";
                const point = item.payload as Record<typeof milesKey, number>;
                return [`${value}% (${point[milesKey]} mi)`, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="easy" stackId="a" fill="#22c55e" name="Easy">
              <LabelList dataKey="easy" position="center" formatter={(value: number) => (value >= 12 ? `${value}%` : "")} fill="#ffffff" fontSize={11} />
            </Bar>
            <Bar dataKey="threshold" stackId="a" fill="#f59e0b" name="Threshold">
              <LabelList dataKey="threshold" position="center" formatter={(value: number) => (value >= 12 ? `${value}%` : "")} fill="#ffffff" fontSize={11} />
            </Bar>
            <Bar dataKey="marathon" stackId="a" fill="#3b82f6" name="Marathon Pace">
              <LabelList dataKey="marathon" position="center" formatter={(value: number) => (value >= 12 ? `${value}%` : "")} fill="#ffffff" fontSize={11} />
            </Bar>
            <Bar dataKey="vo2" stackId="a" fill="#ef4444" name="VO2">
              <LabelList dataKey="vo2" position="center" formatter={(value: number) => (value >= 12 ? `${value}%` : "")} fill="#ffffff" fontSize={11} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
