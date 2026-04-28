import React from "react";
// ============================================================
// EnduroLab — Mileage Trend Chart
// ============================================================
// Line chart showing weekly mileage progression across
// the training plan with down-week annotations.
// ============================================================

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { MarathonPlan } from "@/lib/training/models";

interface MileageTrendChartProps {
  plan: MarathonPlan;
}

export default function MileageTrendChart({ plan }: MileageTrendChartProps) {
  const data = plan.weeks.map((week) => ({
    week: week.weekNumber,
    mileage: week.totalMileage,
    isDownWeek: week.isDownWeek,
  }));

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Weekly Mileage Trend</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              label={{ value: "Miles", angle: -90, position: "insideLeft", fontSize: 11, fill: "#9ca3af" }}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 13 }}
              formatter={(value: number) => [`${value} mi`, "Mileage"]}
            />
            <ReferenceLine
              y={plan.peakWeeklyMileage}
              stroke="#3da16a"
              strokeDasharray="4 4"
              label={{ value: `Peak: ${plan.peakWeeklyMileage} mi`, position: "top", fontSize: 11, fill: "#3da16a" }}
            />
            <Line
              type="monotone"
              dataKey="mileage"
              stroke="#3da16a"
              strokeWidth={2}
              dot={{ fill: "#3da16a", stroke: "#fff", strokeWidth: 2, r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
