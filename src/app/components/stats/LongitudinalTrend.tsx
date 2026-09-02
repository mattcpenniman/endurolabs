// ============================================================
// EnduroLab — Longitudinal Power @ 140 trend per week
// ============================================================
// Line + confidence-interval area per week, current vs prior.
// ============================================================

"use client";

import React from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface Point {
  weekNumber: number;
  phase: string;
  currentPower140: number | null;
  currentPower140CI: [number, number] | null;
  priorPower140: number | null;
}

export default function LongitudinalTrend({ weeks }: { weeks: Point[] }) {
  if (weeks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Longitudinal Power @ 140</h3>
        <p className="mt-3 text-sm text-gray-500">No weekly Power @ 140 estimates yet.</p>
      </div>
    );
  }

  const data = weeks.map((w) => ({
    name: `W${w.weekNumber}`,
    phase: w.phase.replace(/_/g, " ") || "",
    current: w.currentPower140,
    prior: w.priorPower140,
    lower: w.currentPower140CI ? w.currentPower140CI[0] : null,
    upper: w.currentPower140CI ? w.currentPower140CI[1] : null,
  }));

  const hasCI = weeks.some((w) => w.currentPower140CI !== null);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Longitudinal Power @ 140</h3>
          <p className="mt-1 text-xs text-gray-500">
            Estimated watts at 140 bpm, week over week. Green band shows the 95% confidence interval for the current plan.
          </p>
        </div>
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <defs>
              <linearGradient id="ciFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2b8456" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#2b8456" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
            <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} domain={["dataMin - 20", "dataMax + 20"]} />
            <Tooltip
              labelFormatter={(label) => `Week ${String(label).replace("W", "")}`}
              formatter={(value: unknown, name: string) =>
                name.toLowerCase().includes("current") || name.toLowerCase().includes("prior")
                  ? [`${Math.round(Number(value))} W`, name]
                  : [String(value), name]
              }
            />
            <Legend verticalAlign="top" height={28} />
            {hasCI && (
              <Area
                type="monotone"
                dataKey="upper"
                name="Upper 95%"
                stroke="none"
                fill="url(#ciFill)"
                connectNulls
              />
            )}
            {hasCI && (
              <Area
                type="monotone"
                dataKey="lower"
                name="Lower 95%"
                stroke="none"
                fill="url(#ciFill)"
                connectNulls
              />
            )}
            <Line
              type="monotone"
              dataKey="current"
              name="Current P@140"
              stroke="#2b8456"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="prior"
              name="Prior P@140"
              stroke="#9ca3af"
              strokeWidth={2}
              dot={{ r: 3 }}
              strokeDasharray="6 4"
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
