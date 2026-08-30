import React from "react";
// ============================================================
// EnduroLab — Mileage Trend Chart
// ============================================================
// Line chart showing weekly mileage progression across
// the training plan with down-week annotations.
// ============================================================

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { DailyLog, MarathonPlan } from "@/lib/training/models";
import { formatPlanDate } from "@/lib/training/date-utils";

interface MileageTrendChartProps {
  plan: MarathonPlan;
  dailyLogs?: DailyLog[];
}

export default function MileageTrendChart({ plan, dailyLogs = [] }: MileageTrendChartProps) {
  const data = plan.weeks.map((week) => {
    const weekLogs = dailyLogs.filter((log) => log.weekNumber === week.weekNumber);
    const actualMileage =
      weekLogs.length > 0
        ? Math.round(weekLogs.reduce((sum, log) => sum + log.actualMileage, 0) * 10) / 10
        : undefined;

    return {
      week: week.weekNumber,
      weekLabel: `W${week.weekNumber} · ${formatPlanDate(week.endDate)}`,
      weekEndDate: formatPlanDate(week.endDate),
      mileage: week.totalMileage,
      actualMileage,
      isDownWeek: week.isDownWeek,
    };
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Weekly Mileage Trend</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
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
              label={{ value: "Miles", angle: -90, position: "insideLeft", fontSize: 11, fill: "#9ca3af" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 13 }}
              formatter={(value: number, name: string) => [
                `${value} mi`,
                name === "actualMileage" ? "Actual" : "Planned",
              ]}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as { week: number; weekEndDate: string } | undefined;
                return point ? `Week ${point.week} ending ${point.weekEndDate}` : "";
              }}
            />
            <Legend verticalAlign="top" height={28} />
            <ReferenceLine
              y={plan.peakWeeklyMileage}
              stroke="#3da16a"
              strokeDasharray="4 4"
              label={{ value: `Peak: ${plan.peakWeeklyMileage} mi`, position: "top", fontSize: 11, fill: "#3da16a" }}
            />
            <Line
              type="monotone"
              dataKey="mileage"
              name="Planned"
              stroke="#3da16a"
              strokeWidth={2}
              dot={{ fill: "#3da16a", stroke: "#fff", strokeWidth: 2, r: 3 }}
            />
            <Line
              type="monotone"
              dataKey="actualMileage"
              name="Actual"
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="5 3"
              connectNulls={false}
              dot={{ fill: "#2563eb", stroke: "#fff", strokeWidth: 2, r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
