import React from "react";
// ============================================================
// EnduroLab — Long Run Progression Chart
// ============================================================
// Area chart showing long run distance building through
// base, marathon-specific, and taper phases.
// ============================================================

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { MarathonPlan } from "@/lib/training/models";

interface LongRunProgressionChartProps {
  plan: MarathonPlan;
}

function formatWeekEndDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export default function LongRunProgressionChart({ plan }: LongRunProgressionChartProps) {
  const data = plan.weeks.map((week) => ({
    week: week.weekNumber,
    weekLabel: `W${week.weekNumber} · ${formatWeekEndDate(week.endDate)}`,
    weekEndDate: formatWeekEndDate(week.endDate),
    distance: week.longRunDistance,
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Long Run Progression</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
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
              formatter={(value: number) => [`${value} mi`, "Distance"]}
              labelFormatter={(_, payload) => {
                const point = payload?.[0]?.payload as { week: number; weekEndDate: string } | undefined;
                return point ? `Week ${point.week} ending ${point.weekEndDate}` : "";
              }}
            />
            <ReferenceLine
              y={Math.max(...data.map((d) => d.distance))}
              stroke="#8b5cf6"
              strokeDasharray="4 4"
              label={{ value: `Peak: ${Math.max(...data.map((d) => d.distance))} mi`, position: "top", fontSize: 11, fill: "#8b5cf6" }}
            />
            <Area
              type="monotone"
              dataKey="distance"
              stroke="#8b5cf6"
              fill="#ede9fe"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
