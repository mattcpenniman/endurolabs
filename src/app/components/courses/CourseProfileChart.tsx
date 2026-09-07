// ============================================================
// EnduroLab - Course Profile Chart
// ============================================================
// Overlaying multiple courses' normalized elevation profiles
// (distance-as-percent on the X axis) so a marathon and a
// half-marathon can be read side by side on the same grid.

"use client";

import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface CourseProfileChartProps {
  profiles: Array<{
    key: string;
    name: string;
    role: "target" | "training";
    points: Array<{ axis: number; elevationMeters: number | null }>;
  }>;
}

/** Merge each profile onto a shared axis list and hand one row per axis
 *  to Recharts so lines align across differently sized courses. */
function mergedRows(
  profiles: CourseProfileChartProps["profiles"],
): Array<Record<string, number | string | null>> {
  const axes = new Set<number>();
  for (const p of profiles) {
    for (const point of p.points) axes.add(point.axis);
  }
  const sorted = [...axes].sort((a, b) => a - b);
  return sorted.map((axis) => {
    const row: Record<string, number | string | null> = { axis };
    for (const p of profiles) {
      const point = p.points.find((pp) => Math.abs(pp.axis - axis) < 0.001);
      row[p.key] = point?.elevationMeters ?? null;
    }
    return row;
  });
}

const COLOR_BY_ROLE: Record<string, string> = {
  target: "#3da16a",
  training: "#2563eb",
};

export default function CourseProfileChart({ profiles }: CourseProfileChartProps): React.ReactNode {
  const data = mergedRows(profiles);
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-gray-900">Elevation profile</h3>
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
            <defs>
              {profiles.map((p, index) => (
                <linearGradient key={p.key} id={`course-gradient-${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLOR_BY_ROLE[p.role] ?? "#3da16a"} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={COLOR_BY_ROLE[p.role] ?? "#3da16a"} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="axis"
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              tickFormatter={(value: number) => `${Math.round(value)}%`}
            />
            <YAxis
              tick={{ fontSize: 12, fill: "#9ca3af" }}
              axisLine={{ stroke: "#e5e7eb" }}
              label={{
                value: "Elevation (m)",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 12, fill: "#9ca3af" },
              }}
            />
            <Tooltip
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 13 }}
              labelFormatter={(label: unknown) => `${Math.round(Number(label))}% of course`}
              formatter={(value: unknown, name: unknown) => [
                value === null || value === undefined ? "—" : `${Math.round(Number(value))} m`,
                profiles.find((p) => p.key === name)?.name ?? String(name),
              ]}
            />
            <Legend
              verticalAlign="top"
              height={28}
              formatter={(value: string) => profiles.find((p) => p.key === value)?.name ?? value}
            />
            {profiles.map((p, index) => (
              <Area
                key={p.key}
                type="monotone"
                dataKey={p.key}
                stroke={COLOR_BY_ROLE[p.role] ?? "#3da16a"}
                strokeWidth={2}
                fill={`url(#course-gradient-${index})`}
                connectNulls={false}
                dot={false}
                activeDot={{ r: 3 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
