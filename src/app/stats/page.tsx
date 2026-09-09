// ============================================================
// EnduroLab — Stats Page (top-level, compares current vs prior)
// ============================================================
// Client page that loads the current and a selectable prior plan
// and renders a week-by-week comparison plus the sample-derived
// Power @ HR headline.
// ============================================================

"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUnits } from "@/app/components/units/UnitsProvider";
import {
  paceMinPerMileForDisplay,
  paceUnitAbbr,
  paceUnitSuffix,
  type UnitSystem,
} from "@/lib/units/format";
import type { RunnerProfile, MarathonPlan } from "@/lib/training/models";
import type { GarminConnectionStatus } from "@/lib/activities/models";
import {
  PlanComparison,
  PlanSummary,
  WeekActuals,
  formatPaceShort,
} from "@/lib/analytics/plan-comparison";
import { PowerHeartRateModel } from "@/lib/analytics/models";
import FitnessCurveChart from "@/app/components/stats/FitnessCurveChart";
import LongitudinalTrend from "@/app/components/stats/LongitudinalTrend";
import HeadlineFitnessCard from "@/app/components/stats/HeadlineFitnessCard";
import ActivityExplorer from "@/app/components/stats/ActivityExplorer";
import AveragePowerTrend from "@/app/components/stats/AveragePowerTrend";
import AerobicDecouplingCard, { DecouplingActivity } from "@/app/components/stats/AerobicDecouplingCard";
import LongRunDurabilityCard, { DurabilityActivity } from "@/app/components/stats/LongRunDurabilityCard";
import CadenceByPaceTrend from "@/app/components/stats/CadenceByPaceTrend";
import ElevationGradeCard from "@/app/components/stats/ElevationGradeCard";
import type { CadenceByPaceResult } from "@/lib/analytics/cadence-by-pace";
import type { ElevationGradeAnalysisResult } from "@/lib/analytics/elevation-grade";

interface SavedPlanRow {
  id: string;
  runnerProfile: RunnerProfile;
  planData: MarathonPlan;
  raceName: string | null;
  createdAt: string;
  archivedAt: string | null;
}

interface StatsResponse {
  currentPlanId: string;
  priorPlanId?: string | null;
  comparison: PlanComparison;
  aerobicDecoupling: {
    current: DecouplingActivity[];
    prior: DecouplingActivity[];
  };
  longRunDurability: {
    current: DurabilityActivity[];
    prior: DurabilityActivity[];
  };
  cadenceByPace: {
    current: CadenceByPaceResult;
    prior: CadenceByPaceResult;
  };
  elevationGrade: {
    current: ElevationGradeAnalysisResult;
    prior: ElevationGradeAnalysisResult;
  };
  fitness: {
    current: {
      headline: PowerHeartRateModel | null;
      bestWeekModel: PowerHeartRateModel | null;
      best140: number | null;
      best140Wkg: number | null;
    } | null;
    prior: {
      headline: PowerHeartRateModel | null;
      bestWeekModel: PowerHeartRateModel | null;
      best140: number | null;
      best140Wkg: number | null;
    } | null;
    hasCurrentSamples: boolean;
    hasPriorSamples: boolean;
  } | null;
}

export default function StatsPage() {
  const router = useRouter();
  const { units } = useUnits();
  const [authingDone, setAuthingDone] = useState(false);
  const [plans, setPlans] = useState<SavedPlanRow[]>([]);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [priorPlanId, setPriorPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [garminConnection, setGarminConnection] = useState<GarminConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAuthAndPlans = useCallback(async () => {
    const authRes = await fetch("/api/auth/me");
    if (!authRes.ok) {
      router.replace("/login?redirect=/stats");
      return;
    }
    const auth = (await authRes.json()) as {
      user: { id: string; email: string; name: string | null; currentPlanId: string | null } | null;
    };
    if (!auth.user) {
      router.replace("/login?redirect=/stats");
      return;
    }
    const currentPlanIdFromAuth = auth.user.currentPlanId;
    const listRes = await fetch("/api/plan/list");
    const rows: SavedPlanRow[] = listRes.ok
      ? (await listRes.json()).filter((r: SavedPlanRow) => !r.archivedAt)
      : [];
    setPlans(rows);
    const activeCurrent = currentPlanIdFromAuth ?? rows[0]?.id ?? null;
    setCurrentPlanId(activeCurrent);
    const priorIdx = activeCurrent ? rows.findIndex((r) => r.id === activeCurrent) : -1;
    const priorRow = priorIdx > 0
      ? rows[priorIdx - 1]
      : rows[(priorIdx + 1) % rows.length];
    setPriorPlanId(priorRow?.id ?? null);
    setAuthingDone(true);
  }, [router]);

  useEffect(() => {
    loadAuthAndPlans().catch(() => setAuthingDone(true));
  }, [loadAuthAndPlans]);

  useEffect(() => {
    if (!authingDone || !currentPlanId) return;
    let cancelled = false;
    setLoading(true);
    setGarminConnection(null);
    setError(null);
    const params = new URLSearchParams({ currentPlanId });
    if (priorPlanId) params.set("priorPlanId", priorPlanId);
    const loadStoredData = async (): Promise<{
      data: StatsResponse;
      connection: GarminConnectionStatus | null;
      warning: string | null;
    }> => {
      const [response, activityResponse] = await Promise.all([
        fetch(`/api/stats?${params.toString()}`),
        fetch(`/api/integrations/garmin?planId=${encodeURIComponent(currentPlanId)}`),
      ]);
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error ?? "Failed to load stats");
      const data = (await response.json()) as StatsResponse;
      const connection = activityResponse.ok
        ? await activityResponse.json() as GarminConnectionStatus
        : null;
      return {
        data,
        connection,
        warning: activityResponse.ok ? null : "Activity detail status could not be loaded.",
      };
    };
    const load = async (): Promise<void> => {
      const initial = await loadStoredData();
      if (!cancelled) {
        setStats(initial.data);
        setGarminConnection(initial.connection);
        setError(initial.warning);
        setLoading(false);
      }

      const syncResponse = await fetch("/api/integrations/garmin/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: currentPlanId }),
      });
      if (!syncResponse.ok) {
        const body = (await syncResponse.json().catch(() => ({}))) as { error?: string };
        if (!cancelled) {
          setError(body.error ?? "Garmin refresh failed; showing stored stats.");
        }
        return;
      }

      const refreshed = await loadStoredData();
      if (!cancelled) {
        setStats(refreshed.data);
        setGarminConnection(refreshed.connection);
        setError(refreshed.warning);
      }
    };
    load()
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [authingDone, currentPlanId, priorPlanId]);

  const currentPlan = plans.find((p) => p.id === currentPlanId) ?? null;
  const priorPlan = plans.find((p) => p.id === priorPlanId) ?? null;
  const currentActivities = garminConnection?.activities ?? [];
  const hasStoredDetail = currentActivities.some((activity) => activity.sampleCount > 0);
  const currentSummaryRow = useMemo(() => {
    if (!currentPlan) return null;
    return {
      label: currentPlan.raceName ?? (currentPlan.runnerProfile.raceName ?? "Current plan"),
      raceName: currentPlan.raceName,
      raceDate: currentPlan.runnerProfile.raceDate,
      weeks: currentPlan.planData.totalWeeks,
      peakWeek: currentPlan.planData.peakWeeklyMileage,
      created: new Date(currentPlan.createdAt).toISOString().slice(0, 10),
    };
  }, [currentPlan]);
  const priorSummaryRow = useMemo(() => {
    if (!priorPlan) return null;
    return {
      label: priorPlan.raceName ?? (priorPlan.runnerProfile.raceName ?? "Prior plan"),
      raceName: priorPlan.raceName,
      raceDate: priorPlan.runnerProfile.raceDate,
      weeks: priorPlan.planData.totalWeeks,
      peakWeek: priorPlan.planData.peakWeeklyMileage,
      created: new Date(priorPlan.createdAt).toISOString().slice(0, 10),
    };
  }, [priorPlan]);

  if (!authingDone) {
    return (
      <div className="section-padding">
        <div className="container-narrow flex items-center justify-center py-32">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-enduro-200 border-t-enduro-600" />
            <p className="text-lg font-medium text-gray-700">Loading your stats…</p>
          </div>
        </div>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="section-padding">
        <div className="container-narrow">
          <h1 className="text-3xl font-bold text-gray-900">Stats</h1>
          <p className="mt-2 text-gray-600">No saved plans yet. Create a training plan in
            <Link href="/plan" className="ml-1 text-enduro-600 underline">My Plans</Link>.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-padding">
      <div className="container-narrow space-y-8">
        <header className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Stats</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600">
                Compare <span className="font-medium text-enduro-700">current</span> vs
                <span className="font-medium"> prior</span> plans week by week. If Garmin
                sample data is available, a Power @ 140 bpm estimate is computed per
                week and a plan-level headline is shown.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="text-xs font-medium text-gray-500">
                Current plan
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  value={currentPlanId ?? ""}
                  onChange={(e) => setCurrentPlanId(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.raceName ?? `Plan ${p.id.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-gray-500">
                Prior plan
                <select
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                  value={priorPlanId ?? ""}
                  onChange={(e) => setPriorPlanId(e.target.value || null)}
                >
                  <option value="">— none —</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.id === currentPlanId}>
                      {p.raceName ?? `Plan ${p.id.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}
        </header>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-enduro-200 border-t-enduro-600" />
              <p className="text-sm text-gray-500">Aggregating actuals…</p>
            </div>
          </div>
        )}

        {stats && !loading && (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <HeadlineFitnessCard
                fitness={stats.fitness?.current ?? null}
                title="Current"
                subtitle={currentSummaryRow?.label ?? "Current plan"}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PlanComparisonCard summary={stats.comparison.summaries.current} title={currentSummaryRow?.label ?? "Current"} />
                <PlanComparisonCard summary={stats.comparison.summaries.prior} title={priorSummaryRow?.label ?? "Prior"} highlight={false} />
              </div>
            </div>

            <AveragePowerTrend
              weeks={stats.comparison.weeks.map((week) => ({
                weekNumber: week.weekNumber,
                phase: week.phase ?? "",
                currentPower: week.current?.averagePower ?? null,
                currentEstimated: week.current?.averagePowerEstimated ?? false,
                priorPower: week.prior?.averagePower ?? null,
                priorEstimated: week.prior?.averagePowerEstimated ?? false,
              }))}
            />

            <AerobicDecouplingCard
              current={stats.aerobicDecoupling.current}
              prior={stats.aerobicDecoupling.prior}
            />

            <LongRunDurabilityCard
              current={stats.longRunDurability.current}
              prior={stats.longRunDurability.prior}
            />

            <CadenceByPaceTrend
              current={stats.cadenceByPace.current}
              prior={stats.cadenceByPace.prior}
            />

            <ElevationGradeCard
              current={stats.elevationGrade?.current ?? {
                totalActivities: 0,
                qualifyingActivities: 0,
                elevationGainFeetPerMile: null,
                distanceMiles: 0,
                weeks: [],
                bands: [],
                rejectionReasons: {},
                partialNote: null,
                suppressReason: "Elevation and duration coverage for at least three runs is required.",
              }}
              prior={stats.elevationGrade?.prior ?? {
                totalActivities: 0,
                qualifyingActivities: 0,
                elevationGainFeetPerMile: null,
                distanceMiles: 0,
                weeks: [],
                bands: [],
                rejectionReasons: {},
                partialNote: null,
                suppressReason: "No prior plan selected.",
              }}
            />

            {stats.fitness?.hasCurrentSamples && (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FitnessCurveChart
                  current={stats.fitness.current ?? null}
                  prior={stats.fitness.prior ?? null}
                />
                <LongitudinalTrend
                  weeks={stats.comparison.weeks.map((w) => ({
                    weekNumber: w.weekNumber,
                    phase: w.phase ?? "",
                    currentPower140: w.current?.fitness?.estimates.find((e) => e.heartRate === 140)?.watts ?? null,
                    currentPower140CI: (() => {
                      const e = w.current?.fitness?.estimates.find((x) => x.heartRate === 140);
                      return e ? [e.lower95, e.upper95] as [number, number] : null;
                    })(),
                    priorPower140: w.prior?.fitness?.estimates.find((e) => e.heartRate === 140)?.watts ?? null,
                    currentModeledPower140: w.current?.fitness
                      ? null
                      : w.current?.modeledFitness?.estimates.find((e) => e.heartRate === 140)?.watts ?? null,
                    priorModeledPower140: w.prior?.fitness
                      ? null
                      : w.prior?.modeledFitness?.estimates.find((e) => e.heartRate === 140)?.watts ?? null,
                  }))}
                />
              </div>
            )}

            {garminConnection && !hasStoredDetail && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">Import activity detail to unlock sample analytics</p>
                <p className="mt-1 max-w-3xl text-amber-800">
                  {currentActivities.length === 0
                    ? "This plan has no matched Garmin runs yet. Sync summaries, then import detail samples."
                    : `None of this plan's ${currentActivities.length} matched runs has stored detail samples yet.`}
                </p>
                <a
                  href="/profile#garmin-detail-sync"
                  className="mt-3 inline-flex rounded-lg bg-amber-900 px-3 py-2 font-semibold text-white hover:bg-amber-800"
                >
                  {garminConnection.connected ? "Open Garmin detail import" : "Connect Garmin and import detail"}
                </a>
              </div>
            )}

            {garminConnection && hasStoredDetail && !stats.fitness?.hasCurrentSamples && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                Detail samples are stored for this plan, but none currently meet the quality and power-source requirements for headline analytics.
              </div>
            )}

            <WeekComparisonTable comparison={stats.comparison} />

            <ActivityExplorer key={currentPlanId} activities={currentActivities} />

            <details className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-600">
              <summary className="cursor-pointer font-medium text-gray-900">Methodology</summary>
              <div className="mt-3 space-y-3 text-xs leading-5">
                <p>
                  <strong className="font-medium text-gray-900">Power @ 140 bpm</strong> — estimated
                  Garmin running power the athlete would produce at a heart rate of 140 bpm.
                  Calculated by Huber regression of power vs. (30-second lagged) heart rate over
                  the steady-aerobic subset of each activity.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Aerobic decoupling</strong> — change
                  in power-to-heart-rate efficiency between halves of a steady run. It requires at least
                  30 usable minutes of measured power and rejects activities where average power changes
                  by more than 10% between halves. Lower values indicate better aerobic durability.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Long-run durability</strong> — final-quarter
                  average speed and measured power as a percentage of the first three quarters, plus the
                  percentage change in heart rate. Aggregate medians include only steady planned long runs;
                  progression and structured sessions remain separate to avoid rewarding intentional fast finishes.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Cadence by pace</strong> — median steps per minute
                  from paired cadence and speed samples, smoothed into 30-second windows and grouped into fixed
                  30-second-per-mile pace bands. A weekly point requires at least 10 usable minutes in that band;
                  Garmin half-cadence samples are converted to full steps per minute. The trend is descriptive
                  and does not apply a universal ideal cadence.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Elevation and grade</strong> — weekly elevation
                  gain in {units === "metric" ? "metres per kilometre" : "feet per mile"}, plus observed pace, heart rate, and measured power across flat, climbing,
                  and descending samples. Each qualifying activity needs at least six usable minutes and real
                  GPS, elevation, and speed coverage; results are suppressed until at least three activities
                  qualify. Grade-adjusted power is shown only for measured sensor power, never modeled value.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Average power</strong> — distance-weighted
                  activity-summary power. A leading ~ marks a weekly or plan value containing power modeled
                  from average running speed rather than measured by the device.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Qualification</strong> — samples must
                  have a plausible HR (90–175), plausible power (80–700 W), and a forward-moving pace
                  (≥1.8 m/s). Each activity is segmented into 30-second windows; windows with a
                  power coefficient of variation above 15% are excluded as likely acceleration/recovery.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Confidence</strong> — a function of:
                  number of distinct activities, total usable minutes, observed HR spread (≥25 bpm
                  required for &quot;High&quot;), and fit R².
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Adherence delta</strong> — mileage
                  coverage of the planned week. Negative deltas mean the current plan is behind the
                  prior plan's pace. Positive deltas mean the current plan is ahead.
                </p>
                <p>
                  <strong className="font-medium text-gray-900">Power @ 140 vs prior</strong> —
                  comparison of estimated watts at 140 bpm. A positive delta means you can produce
                  more output at the same heart rate, so aerobic efficiency is improving.
                </p>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Inline cards ─────────────────────────────────────────

function PlanComparisonCard({ summary, title, highlight = true }: {
  summary: PlanSummary | null;
  title: string;
  highlight?: boolean;
}) {
  const { units } = useUnits();
  const tone = (v: number | null, lowerIsBetter = false) => {
    if (v === null) return "text-gray-400";
    if (v === 0) return "text-gray-500";
    const positive = lowerIsBetter ? v < 0 : v > 0;
    return positive ? "text-enduro-700" : "text-red-600";
  };
  return (
    <div className={`rounded-xl border border-gray-200 bg-white p-5 shadow-sm ${highlight ? "" : "opacity-90"}`}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="mt-3 space-y-2 text-sm">
        <Row label="Planned" value={summary ? `${summary.plannedMileage.toFixed(1)} mi` : "--"} />
        <Row label="Actual" value={summary && summary.actualMileage > 0 ? `${summary.actualMileage.toFixed(1)} mi` : "--"} />
        <Row label="Adherence" value={summary?.adherence !== undefined && summary?.adherence !== null ? `${summary.adherence}%` : "--"} />
        <Row label="Avg pace" value={fmtPace(summary?.averagePace ?? null, units)} />
        <Row label="Avg HR" value={summary?.averageHeartRate ? `${Math.round(summary.averageHeartRate)} bpm` : "--"} />
        <Row label="Power @140" value={summary?.fitnessBest140 !== null && summary?.fitnessBest140 !== undefined ? `${Math.round(summary.fitnessBest140)} W` : "--"} tone={tone(0)} />
      </div>
    </div>
  );
}

function Row({ label, value, tone = "text-gray-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

function fmtPace(pace: number | null, system: UnitSystem): string {
  if (pace === null) return "--";
  return `${formatPaceShort(paceMinPerMileForDisplay(pace, system))}${paceUnitSuffix(system)}`;
}

// ─── Comparison table ─────────────────────────────────────

function WeekComparisonTable({ comparison }: { comparison: PlanComparison }) {
  const { units } = useUnits();
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-900">
          Week-by-week actuals — current vs prior
        </h3>
        <span className="text-xs text-gray-500">
          {comparison.weeks.length} weeks shown
        </span>
      </div>
      <table className="w-full min-w-[920px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
            <th className="px-3 py-2 font-medium">Week</th>
            <th className="px-3 py-2 font-medium">Phase</th>
            <th className="px-3 py-2 font-medium text-right">Planned</th>
            <th className="px-3 py-2 font-medium text-right">Cur. Actual</th>
            <th className="px-3 py-2 font-medium text-right">Pr. Actual</th>
            <th className="px-3 py-2 font-medium text-right">Δ Mi</th>
            <th className="px-3 py-2 font-medium text-right">Cur. Pace</th>
            <th className="px-3 py-2 font-medium text-right">Pr. Pace</th>
            <th className="px-3 py-2 font-medium text-right">Δ Pace</th>
            <th className="px-3 py-2 font-medium text-right">Cur. Avg HR</th>
            <th className="px-3 py-2 font-medium text-right">Pr. Avg HR</th>
            <th className="px-3 py-2 font-medium text-right">Cur. P@140</th>
            <th className="px-3 py-2 font-medium text-right">Pr. P@140</th>
            <th className="px-3 py-2 font-medium text-right">Δ P@140 (W)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {comparison.weeks.map((row) => (
            <tr key={row.weekNumber} className="hover:bg-gray-50/70">
              <td className="px-3 py-2 font-medium text-gray-900">W{row.weekNumber}</td>
              <td className="px-3 py-2 text-gray-500">{row.phase ? row.phase.replace(/_/g, " ") : "--"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtMiles(row.prior?.plannedMileage ?? row.current?.plannedMileage ?? null)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtMiles(row.current?.actualMileage ?? null)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtMiles(row.prior?.actualMileage ?? null)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${deltaClass(row.deltaMileage)}`}>
                {row.deltaMileage === null ? "--" : (row.deltaMileage > 0 ? "+" : "") + row.deltaMileage.toFixed(1)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtPace(row.current?.averagePace ?? null, units)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtPace(row.prior?.averagePace ?? null, units)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${deltaClass(row.deltaPace === null ? null : -row.deltaPace)}`}>
                {row.deltaPace === null ? "--" : (row.deltaPace > 0 ? "+" : "") + paceMinPerMileForDisplay(row.deltaPace, units).toFixed(2) + ` min/${paceUnitAbbr(units)}`}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{row.current?.averageHeartRate ? `${Math.round(row.current.averageHeartRate)}` : "--"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{row.prior?.averageHeartRate ? `${Math.round(row.prior.averageHeartRate)}` : "--"}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900">{fmtWatts140(row.current?.fitness ?? null, row.current?.modeledFitness ?? null)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-700">{fmtWatts140(row.prior?.fitness ?? null, row.prior?.modeledFitness ?? null)}</td>
              <td className={`px-3 py-2 text-right tabular-nums font-medium ${deltaClass(row.deltaPower140)}`}>
                {row.deltaPower140 === null
                  ? "--"
                  : `${row.deltaPower140Estimated ? "~" : ""}${row.deltaPower140 > 0 ? "+" : ""}${row.deltaPower140}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtMiles(miles: number | null): string {
  if (miles === null || !Number.isFinite(miles)) return "--";
  return `${miles.toFixed(1)} mi`;
}

function fmtWatts140(
  measured: PowerHeartRateModel | null,
  modeled: PowerHeartRateModel | null,
): string {
  const m = measured ?? modeled;
  if (!m) return "--";
  const estimate = m.estimates.find((e) => e.heartRate === 140) ?? m.estimates[0];
  if (!estimate) return "--";
  return `${measured ? "" : "~"}${Math.round(estimate.watts)} W`;
}

function deltaClass(delta: number | null): string {
  if (delta === null || Number.isNaN(delta)) return "text-gray-400";
  if (Math.abs(delta) < 0.05) return "text-gray-500";
  return delta > 0 ? "text-enduro-700" : "text-red-600";
}
