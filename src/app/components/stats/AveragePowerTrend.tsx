// ============================================================
// EnduroLab - Weekly average activity power trend
// ============================================================

"use client";

import React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface AveragePowerPoint {
  weekNumber: number;
  phase: string;
  currentPower: number | null;
  currentEstimated: boolean;
  priorPower: number | null;
  priorEstimated: boolean;
}

export default function AveragePowerTrend({ weeks }: { weeks: AveragePowerPoint[] }): React.ReactNode {
  const populated = weeks.filter((week) => week.currentPower !== null || week.priorPower !== null);
  const currentIncludesEstimates = populated.some((week) => week.currentPower !== null && week.currentEstimated);
  const priorIncludesEstimates = populated.some((week) => week.priorPower !== null && week.priorEstimated);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Weekly Average Power</h3>
      <p className="mt-1 text-xs text-gray-500">
        Distance-weighted activity power by plan week. Dashed lines include one or more speed-modeled activities.
      </p>
      {populated.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-500">No average-power summaries are available.</p>
      ) : (
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={populated.map((week) => ({
                name: `W${week.weekNumber}`,
                phase: week.phase.replace(/_/g, " "),
                current: week.currentPower,
                prior: week.priorPower,
                currentEstimated: week.currentEstimated,
                priorEstimated: week.priorEstimated,
              }))}
              margin={{ top: 4, right: 8, left: -8, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "#9ca3af" }}
                unit=" W"
                domain={["dataMin - 15", "dataMax + 15"]}
              />
              <Tooltip
                labelFormatter={(label) => String(label).replace("W", "Week ")}
                formatter={(value: unknown, name: string) => {
                  const estimated = name === "Current avg" ? currentIncludesEstimates : priorIncludesEstimates;
                  return [`${estimated ? "~" : ""}${Math.round(Number(value))} W`, name];
                }}
              />
              <Legend verticalAlign="top" height={28} />
              <Line
                type="monotone"
                dataKey="current"
                name="Current avg"
                stroke="#2b8456"
                strokeWidth={2.5}
                strokeDasharray={currentIncludesEstimates ? "6 4" : undefined}
                dot={{ r: 3 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="prior"
                name="Prior avg"
                stroke="#64748b"
                strokeWidth={2.25}
                strokeDasharray={priorIncludesEstimates ? "6 4" : undefined}
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
