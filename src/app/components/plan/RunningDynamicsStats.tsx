"use client";

/** Sensor dynamics in the existing Stats tab; SVG chart also renders in run-card PNG exports. */
import React, { useState } from "react";
import type { ActivityDetailResponse, RunActivity } from "@/lib/activities/models";
import { DYNAMICS_KEYS, type DynamicsKey } from "@/lib/activities/running-dynamics";
import { DYNAMICS_LABELS, formatDynamics, formatDynamicsCoverage } from "@/lib/activities/dynamics-format";
import { paceMinPerMileForDisplay, paceUnitSuffix, type UnitSystem } from "@/lib/units/format";

function pace(value: number | null, units: UnitSystem): string {
  if (value === null) return "Unavailable";
  const seconds = Math.round(paceMinPerMileForDisplay(value, units) * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}${paceUnitSuffix(units)}`;
}

export default function RunningDynamicsStats({ activity, detail, units }: {
  activity: RunActivity; detail: ActivityDetailResponse | null; units: UnitSystem;
}): React.ReactNode {
  const [selected, setSelected] = useState<DynamicsKey>("strideLengthCm");
  const report = detail?.dynamics;
  const bins = report?.bins ?? [];
  // A partially observed display bin is a gap, never a line across missing data.
  const complete = bins.map((bin) => bin.metrics[selected].validSeconds >= bin.durationSeconds - 1e-6);
  const values = bins.flatMap((bin, index) => complete[index] && bin.metrics[selected].average !== null ? [bin.metrics[selected].average!] : []);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max - min || Math.max(1, max * 0.05);
  const end = report?.durationSeconds || 1;
  const paceValues = bins.flatMap((bin) => bin.eligibleSeconds >= bin.durationSeconds - 1e-6 && bin.paceMinutesPerMile !== null ? [bin.paceMinutesPerMile] : []);
  const paceMin = paceValues.length ? Math.min(...paceValues) : 0;
  const paceMax = paceValues.length ? Math.max(...paceValues) : 1;
  const y = (value: number): number => 145 - (value - min) / span * 115;
  const x = (seconds: number): number => 20 + seconds / end * 660;
  return <section aria-label="Running dynamics" className="space-y-3">
    <h4 className="text-sm font-semibold text-gray-900">Running dynamics</h4>
    <p className="text-xs text-gray-500">Compare at similar pace and terrain. Device and sensor differences affect these measurements; lower is not universally better. These are descriptions, not a form score.</p>
    <p className="text-xs text-gray-500">Stride length describes forward travel; oscillation describes vertical movement; ratio relates vertical movement to stride length. Contact time describes time on the ground, and balance its left/right distribution.</p>
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {DYNAMICS_KEYS.map((key) => {
        const traceAverage = report?.metrics[key].average;
        const hasTraceAverage = traceAverage != null;
        return <div key={key} className="rounded-lg bg-enduro-50 p-3">
        <dt className="text-xs text-enduro-700">{DYNAMICS_LABELS[key]}</dt>
        <dd className="mt-1 text-sm font-semibold text-enduro-900">{formatDynamics(key, hasTraceAverage ? traceAverage : activity[key], units)}</dd>
        <dd className="mt-1 text-[11px] text-gray-600">{hasTraceAverage ? "Full-trace average" : "Provider run average"}</dd>
        <dd className="mt-2 text-xs text-gray-700">{hasTraceAverage
          ? `Provider run average: ${activity[key] == null ? "Not stored" : formatDynamics(key, activity[key], units)}`
          : `Trace: ${detail ? "Unavailable" : "Loading…"}`}</dd>
        <dd className="text-[11px] text-gray-500">{formatDynamicsCoverage(report?.metrics[key])}</dd>
      </div>; })}
    </dl>
    <p className="text-xs text-gray-500">Full-trace averages are shown when available; otherwise the stored provider run average is shown. Historical detail backfills do not populate provider averages, so these may be not stored even when a trace average is available. Trace averages use full stored samples, independently per metric, with both endpoints present. Gaps over 30 s and stationary/invalid-speed intervals are excluded. Provider averages may use different filtering. Eligible time: {report ? `${report.eligibleSeconds.toFixed(1)} s of ${report.durationSeconds.toFixed(1)} s recorded` : "unavailable"}.</p>
    {!detail ? <p role="status" className="text-sm text-gray-500">Loading dynamics…</p> : <>
      <label className="block text-xs text-gray-700">Chart metric
        <select className="ml-2 max-w-full rounded border border-gray-300 p-2" value={selected} onChange={(event) => setSelected(event.target.value as DynamicsKey)}>
          {DYNAMICS_KEYS.map((key) => <option key={key} value={key}>{DYNAMICS_LABELS[key]}</option>)}
        </select>
      </label>
      <p className="text-xs font-medium text-gray-700">{DYNAMICS_LABELS[selected]} · green | Pace · blue (separate scale)</p>
      {values.length === 0 ? <p className="text-sm text-gray-500">No complete chart intervals for this metric. Missing trace data is unavailable, not zero; partial-bin averages remain in the coverage details below.</p> :
        <svg viewBox="0 0 700 205" className="w-full rounded border border-gray-200 bg-white" role="img" aria-label={`${DYNAMICS_LABELS[selected]} and pace over elapsed time`}>
          <title>{DYNAMICS_LABELS[selected]} and pace; gaps remain disconnected</title>
          <text x="20" y="16" fontSize="10">{formatDynamics(selected, max, units)}</text>
          <text x="20" y="168" fontSize="10">{formatDynamics(selected, min, units)}</text>
          <text x="680" y="16" textAnchor="end" fontSize="10" fill="#2563eb">{pace(paceMax, units)}</text>
          <text x="680" y="168" textAnchor="end" fontSize="10" fill="#2563eb">{pace(paceMin, units)}</text>
          {bins.map((bin, index) => <g key={bin.startSeconds}>
            {complete[index] && bin.metrics[selected].average !== null && <line x1={x(bin.startSeconds)} x2={x(bin.endSeconds)} y1={y(bin.metrics[selected].average!)} y2={y(bin.metrics[selected].average!)} stroke="#15803d" strokeWidth="2"><title>{`${bin.startSeconds}–${bin.endSeconds} s: ${formatDynamics(selected, bin.metrics[selected].average, units)}; ${formatDynamicsCoverage(bin.metrics[selected])}; pace ${pace(bin.paceMinutesPerMile, units)}`}</title></line>}
            {bin.eligibleSeconds >= bin.durationSeconds - 1e-6 && bin.paceMinutesPerMile !== null && <line x1={x(bin.startSeconds)} x2={x(bin.endSeconds)} y1={145 - (bin.paceMinutesPerMile - paceMin) / (paceMax - paceMin || 1) * 115} y2={145 - (bin.paceMinutesPerMile - paceMin) / (paceMax - paceMin || 1) * 115} stroke="#2563eb" strokeWidth="1" />}
          </g>)}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <text key={fraction} x={x(end * fraction)} y="195" textAnchor={fraction === 1 ? "end" : "start"} fontSize="11">{(end * fraction / 60).toFixed(1)} min</text>)}
        </svg>}
      <p className="text-xs text-gray-500">Time-aligned weighted bins (up to 360), calculated before display reduction. Incomplete bins are left blank to preserve null gaps and stops.</p>
      <details className="text-xs text-gray-600"><summary>Chart values & coverage (read-only)</summary>
        <div className="max-h-64 overflow-auto"><table className="w-full text-left"><thead><tr><th>Elapsed (s)</th><th>{DYNAMICS_LABELS[selected]}</th><th>Coverage</th><th>Pace</th></tr></thead><tbody>
          {bins.map((bin) => <tr key={bin.startSeconds}><td>{bin.startSeconds}–{bin.endSeconds}</td><td>{formatDynamics(selected, bin.metrics[selected].average, units)}</td><td>{formatDynamicsCoverage(bin.metrics[selected])}</td><td>{pace(bin.paceMinutesPerMile, units)}</td></tr>)}
        </tbody></table></div>
      </details>
    </>}
  </section>;
}
