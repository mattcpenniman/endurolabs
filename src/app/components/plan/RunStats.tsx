/** Additional run statistics from provider summaries and full-trace effort analysis. */
import React from "react";
import type { ActivityDetailResponse, RunActivity } from "@/lib/activities/models";
import type { TimeAtEffortBreakdown } from "@/lib/analytics/time-at-effort";
import { paceMinPerMileForDisplay, paceUnitSuffix, type UnitSystem } from "@/lib/units/format";
import RunningDynamicsStats from "./RunningDynamicsStats";

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--";
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded / 60) % 60;
  const remainder = String(rounded % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

export default function RunStats({ activity, detail, units }: {
  activity: RunActivity;
  detail: ActivityDetailResponse | null;
  units: UnitSystem;
}): React.ReactNode {
  const moving = activity.movingDurationSeconds;
  const validMoving = moving !== null && Number.isFinite(moving) && moving > 0
    && moving <= activity.durationSeconds
    && activity.distanceMiles > 0
    && activity.distanceMiles * 1609.344 / moving <= 12;
  const movingSeconds = validMoving ? moving : null;
  const paceSeconds = movingSeconds !== null
    ? paceMinPerMileForDisplay(movingSeconds / 60 / activity.distanceMiles, units) * 60 : null;
  const stats = [
    ["Recorded time", duration(activity.durationSeconds)],
    ["Moving time", duration(movingSeconds)],
    ["Time outside moving", duration(movingSeconds === null ? null : activity.durationSeconds - movingSeconds)],
    ["Moving pace", paceSeconds === null ? "--" : `${duration(paceSeconds)}${paceUnitSuffix(units)}`],
  ];
  return <div className="space-y-6 p-5">
    <RunningDynamicsStats key={activity.id} activity={activity} detail={detail} units={units} />
    <section aria-label="Run timing">
      <h4 className="text-sm font-semibold text-gray-900">Time & pace</h4>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => <div key={label} className="rounded-lg bg-enduro-50 px-3 py-2">
          <dt className="text-xs text-enduro-700">{label}</dt>
          <dd className="mt-1 text-sm font-semibold tabular-nums text-enduro-900">{value}</dd>
        </div>)}
      </dl>
      <p className="mt-2 text-xs text-gray-500">Provider summary times; moving pace uses the recorded distance. Time outside moving is the difference between recorded and moving time, not a detected pause count. Missing or inconsistent moving time is unavailable.</p>
    </section>
    <section aria-label="Time at effort">
      <h4 className="text-sm font-semibold text-gray-900">Time at effort</h4>
      <p className="mt-1 text-xs text-gray-500">Compared with this activity’s linked plan zones, using the full stored trace. Heart rate and measured power are classified independently. Stationary intervals and gaps over 30 seconds are excluded; these are descriptive effort bands, not a fitness score.</p>
      {!detail ? <p role="status" className="mt-3 text-sm text-gray-500">Loading effort stats…</p>
        : <div className="mt-4 grid gap-4 md:grid-cols-2">
          <EffortBreakdown title="Heart rate" breakdown={detail.timeAtEffort?.heartRate} />
          <EffortBreakdown title="Measured power" breakdown={activity.averagePowerEstimated || activity.powerSource?.startsWith("estimated_") ? null : detail.timeAtEffort?.power} />
        </div>}
    </section>
  </div>;
}

const ZONE_LABELS = { recovery: "Recovery", easy: "Easy", marathon: "Marathon", threshold: "Threshold", vo2: "VO2 / faster" };

function EffortBreakdown({ title, breakdown }: {
  title: string;
  breakdown: TimeAtEffortBreakdown | null | undefined;
}): React.ReactNode {
  return <section aria-label={`${title} effort`} className="rounded-lg border border-gray-200 p-4">
    <h5 className="text-sm font-semibold text-gray-800">{title}</h5>
    {!breakdown ? <p className="mt-2 text-xs text-gray-500">Unavailable: linked plan zones and recorded {title === "Heart rate" ? "heart rate" : "sensor power"} are required. Shared views may not include effort analysis.</p>
      : <>
        <p className="mt-1 text-xs text-gray-500">{duration(breakdown.totalSeconds)} classified · {duration(breakdown.unclassifiedSeconds)} missing metric in eligible intervals</p>
        {breakdown.totalSeconds === 0 && <p className="mt-2 text-xs text-gray-500">No classifiable time recorded.</p>}
        <dl className="mt-3 space-y-3">
          {breakdown.buckets.map(({ zone, seconds }) => {
            const percent = breakdown.totalSeconds > 0 ? seconds / breakdown.totalSeconds * 100 : null;
            return <div key={zone}>
              <div className="flex justify-between gap-2 text-xs">
                <dt className="text-gray-600">{ZONE_LABELS[zone]}</dt>
                <dd className="font-medium tabular-nums text-gray-900">{duration(seconds)} · {percent === null ? "--" : `${Math.round(percent)}%`}</dd>
              </div>
              <div aria-hidden="true" className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full bg-enduro-600" style={{ width: `${percent ?? 0}%` }} />
              </div>
            </div>;
          })}
        </dl>
        <p className="mt-3 text-[11px] text-gray-500">Percentages use classified time only. Missing metrics, excluded intervals and unrecorded time are not zero-effort time.</p>
      </>}
  </section>;
}
