// ============================================================
// EnduroLab — Fitness Curve (HR vs. Power)
// ============================================================
// Plots predicted power as a function of heart rate for the
// current week-window and, optionally, the prior. Highlights
// the standardised 130/140/150 bpm reference points.
// ============================================================

"use client";

import React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PowerHeartRateModel } from "@/lib/analytics/models";

export interface FitnessWrapper {
  headline: PowerHeartRateModel | null;
  bestWeekModel: PowerHeartRateModel | null;
  best140: number | null;
  best140Wkg: number | null;
}

interface FitnessCurveChartProps {
  current: FitnessWrapper | null;
  prior?: FitnessWrapper | null;
}

function curveData(model: PowerHeartRateModel | null): Array<{ hr: number; watts: number; lower: number; upper: number }> {
  if (!model) return [];
  const [lo, hi] = model.observedHeartRateRange;
  const min = Math.floor(Math.min(lo, 130));
  const max = Math.ceil(Math.max(hi, 150));
  const points: Array<{ hr: number; watts: number; lower: number; upper: number }> = [];
  for (let hr = min; hr <= max; hr += 2) {
    const watts = model.intercept + model.slope * hr;
    if (!Number.isFinite(watts)) continue;
    points.push({
      hr,
      watts,
      lower: watts,
      upper: watts,
    });
  }
  return points;
}

function referencePoints(model: PowerHeartRateModel | null): Array<{ hr: number; watts: number }> {
  if (!model) return [];
  return [130, 140, 150].map((hr) => {
    const estimate = model.estimates.find((e) => e.heartRate === hr);
    if (!estimate) return { hr, watts: NaN };
    return { hr, watts: estimate.watts };
  });
}

export default function FitnessCurveChart({ current, prior }: FitnessCurveChartProps) {
  const activeCurrent = current?.bestWeekModel ?? current?.headline ?? null;
  const priorActive = prior?.bestWeekModel ?? prior?.headline ?? null;
  const currentData = curveData(activeCurrent);
  const priorData = priorActive ? curveData(priorActive) : [];

  if (currentData.length === 0 && priorData.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Fitness curve</h3>
        <p className="mt-3 text-sm text-gray-500">No data to plot.</p>
      </div>
    );
  }

  const unionHr = [
    ...new Set([
      ...currentData.map((p) => p.hr),
      ...priorData.map((p) => p.hr),
    ]).values(),
  ].sort((a, b) => a - b);

  const data = unionHr.map((hr) => {
    const c = currentData.find((p) => p.hr === hr);
    const p = priorData.find((x) => x.hr === hr);
    return {
      hr,
      current: c?.watts ?? null,
      prior: p?.watts ?? null,
    };
  });

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Fitness curve</h3>
          <p className="mt-1 text-xs text-gray-500">Predicted power as a function of heart rate (bpm).</p>
        </div>
      </div>
      <div className="mt-3 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
            <XAxis
              dataKey="hr"
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              label={{ value: "Heart rate (bpm)", position: "insideBottom", offset: -4, fontSize: 11, fill: "#6b7280" }}
              domain={["dataMin", "dataMax"]}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#9ca3af" }}
              label={{ value: "Power (W)", angle: -90, position: "insideLeft", fontSize: 11, fill: "#6b7280" }}
              domain={["dataMin - 20", "dataMax + 20"]}
            />
            <Tooltip
              labelFormatter={(hr) => `${hr} bpm`}
              formatter={(value: number, name: string) => [`${Math.round(value as number)} W`, name]}
            />
            <Legend verticalAlign="top" height={28} />
            {currentData.length > 0 && (
              <Line
                type="monotone"
                dataKey="current"
                name="Current"
                stroke="#2b8456"
                strokeWidth={2.5}
                dot={false}
                connectNulls
              />
            )}
            {priorData.length > 0 && (
              <Line
                type="monotone"
                dataKey="prior"
                name="Prior"
                stroke="#9ca3af"
                strokeWidth={2}
                dot={false}
                strokeDasharray="6 4"
                connectNulls
              />
            )}
            {activeCurrent && referencePoints(activeCurrent).map((p) => (
              <ReferenceDot
                key={p.hr}
                x={p.hr}
                y={p.watts}
                r={4}
                fill="#2b8456"
                stroke="#1c4732"
              />
            ))}
            {activeCurrent && [130, 140, 150].map((hr) => (
              <ReferenceLine key={hr} x={hr} stroke="#9ca3af" strokeDasharray="2 4" />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
