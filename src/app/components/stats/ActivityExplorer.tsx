// ============================================================
// EnduroLab - Per-Activity Detail Explorer
// ============================================================

"use client";

import React, { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ActivityChartPoint,
  ActivityDetailResponse,
  RunActivity,
} from "@/lib/activities/models";
import { buildActivityChartData } from "@/lib/activities/activity-chart";
import { useUnits } from "@/app/components/units/UnitsProvider";
import {
  formatPaceForSystem,
  paceUnitAbbr,
  paceUnitSuffix,
  type UnitSystem,
} from "@/lib/units/format";

interface ActivityExplorerProps {
  activities: RunActivity[];
}

interface TraceDefinition {
  key: "power" | "heartRate" | "cadence" | "paceMinutesPerMile";
  title: string;
  unit: string;
  color: string;
  reversed?: boolean;
}

const TRACES: TraceDefinition[] = [
  { key: "power", title: "Power", unit: "W", color: "#2563eb" },
  { key: "heartRate", title: "Heart rate", unit: "bpm", color: "#e11d48" },
  { key: "cadence", title: "Cadence", unit: "spm", color: "#7c3aed" },
  { key: "paceMinutesPerMile", title: "Pace", unit: "/mi", color: "#059669", reversed: true },
];

export default function ActivityExplorer({ activities }: ActivityExplorerProps): React.ReactNode {
  const { units } = useUnits();
  const availableActivities = activities.filter((activity) => activity.sampleCount > 0);
  const [selectedActivityId, setSelectedActivityId] = useState("");
  const [samples, setSamples] = useState<ActivityChartPoint[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedActivity = availableActivities.find((activity) => activity.id === selectedActivityId) ?? null;

  useEffect(() => {
    if (!selectedActivityId) {
      setSamples(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSamples(null);
    setError(null);
    fetch(`/api/activities/${selectedActivityId}`)
      .then(async (response) => {
        const body = (await response.json()) as ActivityDetailResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Failed to load activity detail");
        return body;
      })
      .then((body) => {
        if (!cancelled) setSamples(buildActivityChartData(body.samples));
      })
      .catch((loadError: Error) => {
        if (!cancelled) setError(loadError.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedActivityId]);

  if (availableActivities.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-200 bg-slate-950 px-5 py-5 text-white sm:flex sm:items-end sm:justify-between sm:gap-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">Activity explorer</p>
          <h2 className="mt-1 text-xl font-semibold">Inspect the shape of a run</h2>
          <p className="mt-1 text-xs text-slate-300">Power, heart rate, cadence, and pace from stored detail samples.</p>
        </div>
        <label className="mt-4 block min-w-0 sm:mt-0 sm:w-80">
          <span className="sr-only">Choose an activity</span>
          <select
            value={selectedActivityId}
            onChange={(event) => setSelectedActivityId(event.target.value)}
            className="w-full rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-gray-900"
          >
            <option value="">Choose a run to inspect</option>
            {availableActivities.map((activity) => (
              <option key={activity.id} value={activity.id}>
                {activity.localDate} - {activity.activityName} ({activity.distanceMiles.toFixed(1)} mi)
              </option>
            ))}
          </select>
        </label>
      </div>

      {!selectedActivityId && (
        <p className="px-5 py-10 text-center text-sm text-gray-500">
          Select one of {availableActivities.length} runs with stored detail.
        </p>
      )}
      {loading && <p className="px-5 py-10 text-center text-sm text-gray-500">Loading detail trace...</p>}
      {error && <p className="px-5 py-6 text-sm text-red-600">{error}</p>}
      {samples && samples.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-gray-500">No chartable samples were found for this run.</p>
      )}
      {samples && samples.length > 0 && selectedActivity && (
        <div className="p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <strong className="text-sm text-gray-900">{selectedActivity.activityName}</strong>
            <span>{selectedActivity.localDate}</span>
            <span>{selectedActivity.distanceMiles.toFixed(2)} mi</span>
            <span>{formatElapsed(selectedActivity.durationSeconds)}</span>
            <span>Quality {selectedActivity.qualityScore ?? "pending"}/100</span>
            <span>{selectedActivity.sampleCount.toLocaleString()} stored samples</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {TRACES.map((trace) => (
              <TraceChart key={trace.key} data={samples} trace={trace} units={units} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function TraceChart({ data, trace, units }: {
  data: ActivityChartPoint[];
  trace: TraceDefinition;
  units: UnitSystem;
}): React.ReactNode {
  const isPace = trace.key === "paceMinutesPerMile";
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
        {trace.title} <span className="font-normal normal-case text-gray-400">({isPace ? `min/${paceUnitAbbr(units)}` : trace.unit})</span>
      </h3>
      <div className="mt-2 h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} syncId="activity-detail" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis
              dataKey="elapsedSeconds"
              minTickGap={36}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={formatElapsed}
            />
            <YAxis
              reversed={trace.reversed}
              width={42}
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickFormatter={(value: number) => isPace ? formatPaceForSystem(value, units) : Math.round(value).toString()}
            />
            <Tooltip
              labelFormatter={(value) => formatElapsed(Number(value))}
              formatter={(value: number) => [
                isPace ? `${formatPaceForSystem(value, units)}${paceUnitSuffix(units)}` : `${Math.round(value)} ${trace.unit}`,
                trace.title,
              ]}
            />
            <Line
              type="monotone"
              dataKey={trace.key}
              stroke={trace.color}
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = Math.round(totalSeconds % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
