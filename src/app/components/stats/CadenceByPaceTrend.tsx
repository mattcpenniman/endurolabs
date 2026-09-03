// ============================================================
// EnduroLab - Cadence By Pace Trend
// ============================================================

"use client";

import React, { useMemo, useState } from "react";
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
import type { CadenceByPaceResult, CadencePaceBandTrend } from "@/lib/analytics/cadence-by-pace";

interface CadenceByPaceTrendProps {
  current: CadenceByPaceResult;
  prior: CadenceByPaceResult;
}

interface ChartPoint {
  name: string;
  current: number | null;
  prior: number | null;
  currentMinutes: number | null;
  priorMinutes: number | null;
  currentActivities: number | null;
  priorActivities: number | null;
}

function findBand(result: CadenceByPaceResult, key: string): CadencePaceBandTrend | undefined {
  return result.bands.find((band) => band.key === key);
}

export default function CadenceByPaceTrend({ current, prior }: CadenceByPaceTrendProps): React.ReactNode {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const bands = useMemo(() => {
    const byKey = new Map<string, CadencePaceBandTrend>();
    for (const band of [...current.bands, ...prior.bands]) {
      if (!byKey.has(band.key)) byKey.set(band.key, band);
    }
    return [...byKey.values()]
      .filter((band) => (
        (findBand(current, band.key)?.weeks.length ?? 0) >= 2
        || (findBand(prior, band.key)?.weeks.length ?? 0) >= 2
      ))
      .sort((a, b) => a.minimumPaceSecondsPerMile - b.minimumPaceSecondsPerMile);
  }, [current, prior]);
  const defaultBand = [...bands].sort((a, b) => {
    const support = (result: CadenceByPaceResult, key: string) => (
      findBand(result, key)?.weeks.reduce((sum, week) => sum + week.usableMinutes, 0) ?? 0
    );
    return support(current, b.key) + support(prior, b.key) - support(current, a.key) - support(prior, a.key);
  })[0];
  const activeKey = bands.some((band) => band.key === selectedKey) ? selectedKey! : defaultBand?.key;
  const activeBand = bands.find((band) => band.key === activeKey);
  const currentBand = activeKey ? findBand(current, activeKey) : undefined;
  const priorBand = activeKey ? findBand(prior, activeKey) : undefined;
  const data = useMemo((): ChartPoint[] => {
    const weekNumbers = new Set([
      ...(currentBand?.weeks.map((week) => week.weekNumber) ?? []),
      ...(priorBand?.weeks.map((week) => week.weekNumber) ?? []),
    ]);
    return [...weekNumbers].sort((a, b) => a - b).map((weekNumber) => {
      const currentWeek = currentBand?.weeks.find((week) => week.weekNumber === weekNumber);
      const priorWeek = priorBand?.weeks.find((week) => week.weekNumber === weekNumber);
      return {
        name: `W${weekNumber}`,
        current: currentWeek?.cadenceSpm ?? null,
        prior: priorWeek?.cadenceSpm ?? null,
        currentMinutes: currentWeek?.usableMinutes ?? null,
        priorMinutes: priorWeek?.usableMinutes ?? null,
        currentActivities: currentWeek?.activityCount ?? null,
        priorActivities: priorWeek?.activityCount ?? null,
      };
    });
  }, [currentBand, priorBand]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Cadence by pace</h3>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Your observed cadence at similar running paces. This is descriptive, not a cadence target.
          </p>
        </div>
        {bands.length > 0 && (
          <label className="text-xs font-medium text-gray-500">
            Pace band
            <select
              className="ml-2 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
              value={activeKey}
              onChange={(event) => setSelectedKey(event.target.value)}
            >
              {bands.map((band) => <option key={band.key} value={band.key}>{band.label}</option>)}
            </select>
          </label>
        )}
      </div>

      {!activeBand ? (
        <p className="py-10 text-center text-sm text-gray-500">
          No pace band has at least two qualifying weeks of cadence data yet.
        </p>
      ) : (
        <>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                <YAxis
                  width={62}
                  domain={["dataMin - 4", "dataMax + 4"]}
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickFormatter={(value: number) => `${Math.round(value)} spm`}
                />
                <Tooltip
                  labelFormatter={(label) => `Week ${String(label).replace("W", "")}`}
                  formatter={(value: unknown, name: string, item) => {
                    const plan = name === "Current" ? "current" : "prior";
                    const payload = item.payload as ChartPoint;
                    const minutes = payload[`${plan}Minutes`];
                    const activities = payload[`${plan}Activities`];
                    return [`${Number(value).toFixed(1)} spm, ${minutes} min, ${activities} ${activities === 1 ? "run" : "runs"}`, name];
                  }}
                />
                <Legend verticalAlign="bottom" height={36} />
                <Line type="monotone" dataKey="current" name="Current" stroke="#2b8456" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="prior" name="Prior" stroke="#9ca3af" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Cadence naturally varies with the runner, terrain, fatigue, and conditions. Missing weeks did not meet the minimum support for this pace band.
          </p>
        </>
      )}
    </section>
  );
}
