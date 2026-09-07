"use client";

// ============================================================
// EnduroLab — Plan Page
// ============================================================
// Client page that handles onboarding form submission,
// calls the plan generation API, and renders the full
// plan with charts, weekly cards, and calendar export.
// ============================================================

import React from "react";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RunnerProfile, MarathonPlan, DailyLog, WeeklyPlan, formatPace } from "@/lib/training/models";
import type { PlanListSummary } from "@/lib/activities/plan-list-summary";
import OnboardingForm from "@/app/components/onboarding/OnboardingForm";
import PlanOverviewCard from "@/app/components/plan/PlanOverviewCard";
import PaceZonesCard from "@/app/components/plan/PaceZonesCard";
import WeeklyPlanCard from "@/app/components/plan/WeeklyPlanCard";
import RaceDayPlanCard from "@/app/components/plan/RaceDayPlanCard";
import Sub3Scorecard from "@/app/components/plan/Sub3Scorecard";
import MileageTrendChart from "@/app/components/charts/MileageTrendChart";
import LongRunProgressionChart from "@/app/components/charts/LongRunProgressionChart";
import IntensityDistributionChart from "@/app/components/charts/IntensityDistributionChart";
import RunTrendChart from "@/app/components/charts/RunTrendChart";
import GarminSyncCard from "@/app/components/plan/GarminSyncCard";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import { GarminConnectionStatus } from "@/lib/activities/models";
import { generateRaceDayPlan } from "@/lib/training/race-day-plan";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { analyzeProgress, areAllPhaseRunsLogged, dailyLogsToWeeklyLogs } from "@/lib/training/progress-tracker";
import { adjustWeeklyIntensityPercent } from "@/lib/training/intensity-adjustments";
import { buildPlanUrl, PlanUrlUpdates } from "@/lib/plan-url";

// Shape of a saved plan row from the database
interface SavedPlanRow {
  id: string;
  runnerProfile: RunnerProfile;
  planData: MarathonPlan;
  peakMileageOverride: number | null;
  weeksOverride: number | null;
  raceName: string | null;
  createdAt: string;
  archivedAt: string | null;
  shareToken: string | null;
  sharedAt: string | null;
  summary: PlanListSummary;
}

interface SavePlanResponse {
  success: boolean;
  id: string;
  planData: MarathonPlan;
}

interface AuthMeResponse {
  user: {
    id: string;
    email: string;
    name: string | null;
    currentPlanId: string | null;
  } | null;
}

type PlanTab = "overview" | "schedule" | "race" | "scorecard" | "settings";
type RaceDistanceKey = NonNullable<RunnerProfile["raceDistance"]>;
type IntensityTargetKey = keyof NonNullable<RunnerProfile["intensityTargetPercents"]>;
const OPEN_CURRENT_PLAN_EVENT = "endurlab-open-current-plan";
const EMPTY_GARMIN_STATUS: GarminConnectionStatus = { connected: false, activities: [] };

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const RACE_DISTANCES: Array<{ key: RaceDistanceKey; label: string; miles: number }> = [
  { key: "marathon", label: "Marathon", miles: 26.2 },
  { key: "half_marathon", label: "Half Marathon", miles: 13.1 },
  { key: "10k", label: "10K", miles: 6.2 },
  { key: "5k", label: "5K", miles: 3.1 },
];
type PacingStrategy = NonNullable<RunnerProfile["racePacingStrategy"]>;
const MILEAGE_BUILD_STEPS = 4;
const DEFAULT_INTENSITY_TARGET_PERCENTS: NonNullable<RunnerProfile["intensityTargetPercents"]> = {
  marathon: 10,
  threshold: 6,
  vo2: 2,
};
const INTENSITY_TARGET_RANGES: Record<IntensityTargetKey, { min: number; max: number }> = {
  marathon: { min: 8, max: 15 },
  threshold: { min: 5, max: 8 },
  vo2: { min: 1, max: 4 },
};

function parsePlanTab(value: string | null): PlanTab | null {
  return value === "overview" || value === "schedule" || value === "race"
    || value === "scorecard" || value === "settings"
    ? value
    : null;
}

function clampMileage(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(5, Math.min(120, Math.round(value)));
}

function recommendedStartMileage(plan: MarathonPlan, runsPerWeek: number): number {
  const buildCapacity = Math.max(0, runsPerWeek * MILEAGE_BUILD_STEPS);
  return clampMileage(plan.peakWeeklyMileage - buildCapacity);
}

function mileageStepPerBuild(startMileage: number, peakMileage: number): number {
  return Math.max(0, (peakMileage - startMileage) / MILEAGE_BUILD_STEPS);
}

function getCurrentIntensityTargetPercents(
  profile: RunnerProfile
): NonNullable<RunnerProfile["intensityTargetPercents"]> {
  return {
    marathon: profile.intensityTargetPercents?.marathon ?? DEFAULT_INTENSITY_TARGET_PERCENTS.marathon,
    threshold: profile.intensityTargetPercents?.threshold ?? DEFAULT_INTENSITY_TARGET_PERCENTS.threshold,
    vo2: profile.intensityTargetPercents?.vo2 ?? DEFAULT_INTENSITY_TARGET_PERCENTS.vo2,
  };
}

function clampIntensityTarget(key: IntensityTargetKey, value: number): number {
  const range = INTENSITY_TARGET_RANGES[key];
  if (!Number.isFinite(value)) return DEFAULT_INTENSITY_TARGET_PERCENTS[key];
  return Math.max(range.min, Math.min(range.max, Math.round(value * 2) / 2));
}

function clampHeartRate(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function formatRaceGoalInput(minutes: number): string {
  const totalSeconds = Math.max(0, Math.round(minutes * 60));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${mins}:${String(seconds).padStart(2, "0")}`;
}

function parseRaceGoalInput(value: string): number | null {
  const parts = value
    .trim()
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return null;
  }

  const [first, second, third] = parts;

  if (parts.length === 2) {
    if (second === undefined || second >= 60) return null;
    return first + second / 60;
  }

  if (second === undefined || third === undefined || second >= 60 || third >= 60) {
    return null;
  }

  return first * 60 + second + third / 60;
}

function toDateKey(date: string): string {
  return new Date(date).toISOString().slice(0, 10);
}

function phaseExpansionKey(planId: string, firstWeek: number): string {
  return `${planId}:${firstWeek}`;
}

function formatPlanDate(value: string | undefined): string {
  if (!value) return "Not set";

  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function PlanSummaryMetrics({ summary }: { summary: PlanListSummary }): React.ReactNode {
  const hasActuals = summary.actualRunCount > 0;
  const planned = Math.round(summary.plannedMileage * 10) / 10;
  const actual = Math.round(summary.actualMileage * 10) / 10;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total miles</dt>
        <dd className="mt-0.5 font-mono text-sm font-semibold text-gray-800">
          {planned.toLocaleString()} <span className="font-sans font-normal text-gray-400">plan</span>
          <span className="mx-1 text-gray-300">/</span>
          {hasActuals ? actual.toLocaleString() : "--"} <span className="font-sans font-normal text-gray-400">actual</span>
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Actual elevation</dt>
        <dd className="mt-0.5 font-mono text-sm font-semibold text-gray-800">
          {summary.actualElevationGainMeters === null
            ? "--"
            : `${Math.round(summary.actualElevationGainMeters * 3.28084).toLocaleString()} ft`}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Average pace</dt>
        <dd className="mt-0.5 font-mono text-sm font-semibold text-gray-800">
          {summary.averagePaceMinutesPerMile === null
            ? "--"
            : `${formatPace(summary.averagePaceMinutesPerMile)} /mi`}
        </dd>
      </div>
      <div>
        <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Actual runs</dt>
        <dd className="mt-0.5 font-mono text-sm font-semibold text-gray-800">
          {hasActuals ? summary.actualRunCount.toLocaleString() : "--"}
        </dd>
      </div>
    </dl>
  );
}

export default function PlanPage(): React.ReactNode {
  return (
    <React.Suspense fallback={<div className="section-padding text-center text-sm text-gray-500">Loading plan...</div>}>
      <PlanPageContent />
    </React.Suspense>
  );
}

function PlanPageContent(): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlanTab = parsePlanTab(searchParams.get("tab"));
  const requestedPlanId = searchParams.get("plan");
  const requestedRunMapActivityId = searchParams.get("runmap");
  const resolvedRequestedPlanTab = requestedPlanTab ?? (requestedRunMapActivityId ? "schedule" : null);
  const [plan, setPlan] = useState<MarathonPlan | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [phaseExpansionOverrides, setPhaseExpansionOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [pacingStrategy, setPacingStrategy] = useState<PacingStrategy>("even");
  const [expectedTempF, setExpectedTempF] = useState(50);
  const [savedPlans, setSavedPlans] = useState<SavedPlanRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [runsPerWeek, setRunsPerWeek] = useState<number | null>(null);
  const [weeksOverride, setWeeksOverride] = useState<number | null>(null);
  const [planName, setPlanName] = useState("");
  const [activePlanTab, setActivePlanTab] = useState<PlanTab>(() => resolvedRequestedPlanTab ?? "overview");
  const [dailyLogRefresh, setDailyLogRefresh] = useState(0);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [garminConnection, setGarminConnection] = useState<GarminConnectionStatus>(EMPTY_GARMIN_STATUS);
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [shareLinkUrl, setShareLinkUrl] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [activePlanId, setActivePlanIdState] = useState<string | null>(null);
  const [pendingCurrentPlanFocus, setPendingCurrentPlanFocus] = useState(false);
  const [hasAttemptedCurrentPlanLoad, setHasAttemptedCurrentPlanLoad] = useState(false);
  const [currentPlanRequestCount, setCurrentPlanRequestCount] = useState(0);
  const [attemptedRequestedPlanId, setAttemptedRequestedPlanId] = useState<string | null>(null);

  const currentView = searchParams.get("view");
  const isListView = currentView === "list" && !requestedPlanId;
  const isCurrentPlanView = currentView === "current" && !requestedPlanId;

  const updatePlanRoute = (
    updates: PlanUrlUpdates,
    method: "push" | "replace" = "replace"
  ): void => {
    const route = buildPlanUrl(searchParams, updates, window.location.hash);
    router[method](route, { scroll: false });
  };

  const openRunMap = (activityId: string): void => {
    updatePlanRoute({ runmap: activityId }, "push");
  };

  const closeRunMap = (): void => {
    updatePlanRoute({ runmap: null });
  };

  useEffect(() => {
    if (!requestedRunMapActivityId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRunMap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestedRunMapActivityId]);

  useEffect(() => {
    let isMounted = true;

    async function loadAuthenticatedPlans(): Promise<void> {
      const authRes = await fetch("/api/auth/me");

      if (!authRes.ok) {
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
        return;
      }

      const authData = (await authRes.json()) as AuthMeResponse;

      const listRes = await fetch("/api/plan/list");

      if (isMounted) {
        setActivePlanIdState(authData.user?.currentPlanId ?? null);
        setSavedPlans(listRes.ok ? await listRes.json() : []);
        setIsCheckingAuth(false);
      }
    }

    loadAuthenticatedPlans().catch(() => {
      if (isMounted) {
        const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [router]);

  const refreshSavedPlans = async (): Promise<void> => {
    const listRes = await fetch("/api/plan/list");
    if (listRes.ok) {
      setSavedPlans(await listRes.json());
    }
  };

  const loadPlanDailyLogs = async (planId: string): Promise<DailyLog[]> => {
    const response = await fetch(`/api/plan/${planId}/logs`);
    if (!response.ok) {
      throw new Error("Failed to load logs");
    }
    return (await response.json()) as DailyLog[];
  };

  const loadGarminConnection = async (planId?: string): Promise<GarminConnectionStatus> => {
    const query = planId ? `?planId=${encodeURIComponent(planId)}` : "";
    const response = await fetch(`/api/integrations/garmin${query}`);
    if (!response.ok) throw new Error("Failed to load Garmin connection");
    return (await response.json()) as GarminConnectionStatus;
  };

  const refreshGarminConnection = async (): Promise<void> => {
    setGarminConnection(await loadGarminConnection(plan?.id));
  };

  useEffect(() => {
    if (!plan?.id) return;

    let isMounted = true;
    loadPlanDailyLogs(plan.id)
      .then((logs) => {
        if (isMounted) setDailyLogs(logs);
      })
      .catch(() => {
        if (isMounted) setError("Failed to load logs");
      });

    return () => {
      isMounted = false;
    };
  }, [plan?.id, dailyLogRefresh]);

  useEffect(() => {
    if (!plan?.id) return;
    let isMounted = true;
    fetch("/api/integrations/garmin/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId: plan.id }),
    })
      .catch(() => null)
      .then(() => loadGarminConnection(plan.id))
      .then((status) => {
        if (isMounted) setGarminConnection(status);
      })
      .catch(() => {
        if (isMounted) setGarminConnection(EMPTY_GARMIN_STATUS);
      });
    return () => {
      isMounted = false;
    };
  }, [plan?.id]);

  const persistCurrentPlan = async (planId: string | null): Promise<boolean> => {
    try {
      const response = await fetch("/api/plan/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPlanId: planId }),
      });

      if (!response.ok) {
        throw new Error("Failed to update current plan");
      }

      setActivePlanIdState(planId);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update current plan");
      return false;
    }
  };

  const getWeekNumberForDate = (targetPlan: MarathonPlan, dateKey: string): number | null => {
    const matchingWeek = targetPlan.weeks.find((week) => {
      const weekStart = toDateKey(week.startDate);
      const lastDay = week.days[week.days.length - 1];
      const weekEnd = lastDay ? toDateKey(lastDay.date) : weekStart;

      return dateKey >= weekStart && dateKey <= weekEnd;
    });

    return matchingWeek?.weekNumber ?? null;
  };

  const getFocusDate = (targetPlan: MarathonPlan, logs: DailyLog[]): string | null => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const allDays = targetPlan.weeks.flatMap((week) => week.days);
    const dateKeys = allDays.map((day) => toDateKey(day.date));
    const isDateComplete = (dateKey: string): boolean => {
      const matchingDay = allDays.find((day) => toDateKey(day.date) === dateKey);
      if (!matchingDay) return false;

      const plannedWorkoutIds = [
        matchingDay.workout?.id,
        matchingDay.secondaryWorkout?.id,
      ].filter((id): id is string => Boolean(id));

      if (plannedWorkoutIds.length === 0) {
        return logs.some((log) => toDateKey(log.date) === dateKey && log.completed);
      }

      const completedRunIds = new Set(
        logs
          .filter((log) => toDateKey(log.date) === dateKey && log.completed)
          .map((log) => log.plannedWorkoutId ?? log.runId)
      );

      return plannedWorkoutIds.every((runId) => completedRunIds.has(runId));
    };

    if (dateKeys.includes(todayStr) && !isDateComplete(todayStr)) {
      return todayStr;
    }

    const nextUpcomingDay = dateKeys.find((dateKey) => dateKey > todayStr);
    if (nextUpcomingDay) return nextUpcomingDay;

    return dateKeys[0] ?? null;
  };

  const focusCurrentSchedule = (targetPlan: MarathonPlan, logs: DailyLog[]): void => {
    const focusDate = getFocusDate(targetPlan, logs);
    const focusWeekNumber = focusDate ? getWeekNumberForDate(targetPlan, focusDate) : null;

    if (focusWeekNumber !== null) {
      setExpandedWeeks(new Set([focusWeekNumber]));
      const phase = targetPlan.phases.find(
        ({ weekRange }) => focusWeekNumber >= weekRange[0] && focusWeekNumber <= weekRange[1]
      );
      if (phase) {
        const phaseKey = phaseExpansionKey(targetPlan.id, phase.weekRange[0]);
        setPhaseExpansionOverrides((current) => ({ ...current, [phaseKey]: true }));
      }
    }

    setActivePlanTab("schedule");
    setPendingCurrentPlanFocus(true);
  };

  const persistPlan = async (
    targetPlan: MarathonPlan,
    customName: string,
    options: { saveAsNew?: boolean } = {}
  ): Promise<MarathonPlan | null> => {
    const trimmedName = customName.trim();
    const runnerProfile: RunnerProfile = {
      ...targetPlan.runnerProfile,
      raceName: trimmedName || undefined,
    };
    const paceZones = calculatePaceZones(runnerProfile);
    const planData: MarathonPlan = {
      ...targetPlan,
      id: options.saveAsNew ? `plan-copy-${Date.now()}` : targetPlan.id,
      runnerProfile,
      paceZones,
      powerZones: calculatePowerZones(runnerProfile, paceZones),
    };

    const saveRes = await fetch("/api/plan/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: options.saveAsNew ? undefined : targetPlan.id,
        runnerProfile,
        planData,
        peakMileageOverride: runnerProfile.peakMileageOverride,
        weeksOverride: runnerProfile.weeksOverride,
        raceName: trimmedName || null,
      }),
    });

    if (!saveRes.ok) {
      return null;
    }

    const saveData = (await saveRes.json()) as SavePlanResponse;
    await refreshSavedPlans();
    return saveData.planData;
  };

  const handleGenerate = async (profile: RunnerProfile) => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });

      if (!response.ok) {
        throw new Error("Failed to generate plan");
      }

      const generatedPlan = await response.json();
      const initialPlanName = profile.raceName?.trim() ?? "";
      setPlanName(initialPlanName);

      // Auto-save to database
      const savedPlan = await persistPlan(generatedPlan, initialPlanName);
      const nextPlan = savedPlan ?? generatedPlan;
      setPlan(nextPlan);
      setDailyLogs([]);
      await persistCurrentPlan(nextPlan.id);
      setShareToken(null);
      setShareLinkUrl(null);
      setRunsPerWeek(
        profile.runsPerWeekOverride
          ? Math.max(3, Math.min(10, profile.runsPerWeekOverride))
          : profile.trainingDaysPerWeek
      );
      setWeeksOverride(
        profile.weeksOverride
          ? Math.max(14, Math.min(28, profile.weeksOverride))
          : generatedPlan.totalWeeks
      );
      setPacingStrategy(nextPlan.runnerProfile.racePacingStrategy ?? "even");
      setExpectedTempF(nextPlan.runnerProfile.expectedRaceTempF ?? 50);
      setExpandedWeeks(new Set());
      setActivePlanTab("overview");
      router.replace("/plan?view=current&tab=overview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePlan = async () => {
    if (!plan) return;
    setIsSaving(true);
    try {
      const savedPlan = await persistPlan(plan, planName);
      if (savedPlan) {
        setPlan(savedPlan);
      }
    } catch {
      // Silently fail — plan is still usable in session
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveAsNewPlan = async () => {
    if (!plan) return;
    setIsSaving(true);
    try {
      const savedPlan = await persistPlan(plan, planName, { saveAsNew: true });
      if (savedPlan) {
        setPlan(savedPlan);
        setDailyLogs([]);
        await persistCurrentPlan(savedPlan.id);
        router.replace("/plan?view=current&tab=overview");
      }
    } catch {
      // Silently fail — plan is still usable in session
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadPlan = async (
    planId: string,
    options: { focusCurrentSchedule?: boolean; updateRoute?: boolean; tab?: PlanTab | null } = {}
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/plan/${planId}`);
      if (!res.ok) throw new Error("Failed to load plan");
      const saved = await res.json();
      const persistedLogs = await loadPlanDailyLogs(saved.id);
      setPlan(saved.planData);
      setDailyLogs(persistedLogs);
      setPlanName(saved.raceName ?? saved.runnerProfile.raceName ?? "");
      setShareToken(saved.shareToken ?? null);
      setShareLinkUrl(saved.shareUrl ?? null);
      setRunsPerWeek(
        saved.runnerProfile.runsPerWeekOverride
          ? Math.max(3, Math.min(10, saved.runnerProfile.runsPerWeekOverride))
          : saved.runnerProfile.trainingDaysPerWeek
      );
      setWeeksOverride(
        saved.runnerProfile.weeksOverride
          ? Math.max(14, Math.min(28, saved.runnerProfile.weeksOverride))
          : saved.planData.totalWeeks
      );
      setPacingStrategy(saved.runnerProfile.racePacingStrategy ?? "even");
      setExpectedTempF(saved.runnerProfile.expectedRaceTempF ?? 50);
      if (options.tab) {
        setExpandedWeeks(new Set());
        setActivePlanTab(options.tab);
        setPendingCurrentPlanFocus(false);
      } else if (options.focusCurrentSchedule) {
        focusCurrentSchedule(saved.planData, persistedLogs);
      } else {
        setExpandedWeeks(new Set());
        setActivePlanTab("overview");
      }
      if (options.updateRoute !== false) {
        router.replace(
          options.focusCurrentSchedule
            ? "/plan?view=current&tab=schedule"
            : buildPlanUrl(new URLSearchParams(), { plan: saved.id, tab: options.tab ?? "overview" })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load plan");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustRunsPerWeek = async (newRuns: number) => {
    if (!plan) return;
    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        runsPerWeekOverride: newRuns,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      setRunsPerWeek(newRuns);
      // Auto-save
      const savedPlan = await persistPlan(regenerated, planName);
      const nextPlan = savedPlan ?? regenerated;
      setPlan(nextPlan);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustDoubleUpDays = async (selectedDays: string[]) => {
    if (!plan) return;
    const nextRunsPerWeek = plan.runnerProfile.trainingDaysPerWeek + selectedDays.length;
    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        preferredDoubleUpDays: selectedDays,
        runsPerWeekOverride: nextRunsPerWeek,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      setRunsPerWeek(nextRunsPerWeek);
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustWeeks = async (newWeeks: number) => {
    if (!plan) return;
    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        weeksOverride: newWeeks,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      setWeeksOverride(newWeeks);
      // Auto-save
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustPeakMileage = async (newPeakMileage: number) => {
    if (!plan || newPeakMileage === plan.peakWeeklyMileage) return;
    setIsLoading(true);
    try {
      const peakMileageOverride = clampMileage(newPeakMileage);
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        peakHistoricalWeeklyMileage: Math.max(plan.runnerProfile.peakHistoricalWeeklyMileage, peakMileageOverride),
        peakMileageOverride,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustStartMileage = async (newStartMileage: number) => {
    if (!plan || newStartMileage === plan.runnerProfile.currentWeeklyMileage) return;
    setIsLoading(true);
    try {
      const currentWeeklyMileage = clampMileage(newStartMileage);
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        currentWeeklyMileage,
        peakHistoricalWeeklyMileage: Math.max(plan.runnerProfile.peakHistoricalWeeklyMileage, currentWeeklyMileage),
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustMaxLongRun = async (newMaxLongRun: number) => {
    if (!plan || !Number.isFinite(newMaxLongRun)) return;

    const maxLongRunOverride = Math.max(4, Math.min(30, Math.round(newMaxLongRun * 2) / 2));
    if (maxLongRunOverride === (plan.runnerProfile.maxLongRunOverride ?? null)) return;

    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        maxLongRunOverride,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustIntensityTarget = async (key: IntensityTargetKey, value: number, weekNumber?: number) => {
    if (!plan) return;

    // Use a wider clamp for weekly overrides to allow user flexibility
    const nextValue = weekNumber === undefined 
      ? clampIntensityTarget(key, value) 
      : Math.max(0, Math.min(50, Math.round(value * 2) / 2));
    
    if (weekNumber === undefined) {
      const currentTargets = getCurrentIntensityTargetPercents(plan.runnerProfile);
      if (nextValue === currentTargets[key]) return;

      setIsLoading(true);
      try {
        const profile = {
          ...plan.runnerProfile,
          raceName: planName.trim() || undefined,
          intensityTargetPercents: {
            ...currentTargets,
            [key]: nextValue,
          },
        };
        const response = await fetch("/api/plan/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profile),
        });
        if (!response.ok) throw new Error("Failed to regenerate plan");
        const regenerated = await response.json();
        regenerated.id = plan.id;
        const savedPlan = await persistPlan(regenerated, planName);
        setPlan(savedPlan ?? regenerated);
      } catch {
        // Silently fail
      } finally {
        setIsLoading(false);
      }
    } else {
      setIsSaving(true);
      try {
        const paceZones = calculatePaceZones(plan.runnerProfile);
        const powerZones = calculatePowerZones(plan.runnerProfile, paceZones);
        const updatedWeeks = plan.weeks.map((week) =>
          week.weekNumber === weekNumber
            ? adjustWeeklyIntensityPercent(week, key, nextValue, paceZones, powerZones)
            : week
        );
        const updatedPlan: MarathonPlan = {
          ...plan,
          runnerProfile: {
            ...plan.runnerProfile,
            raceName: planName.trim() || undefined,
            weeklyIntensityOverrides: {
              ...(plan.runnerProfile.weeklyIntensityOverrides || {}),
              [weekNumber]: {
                ...(plan.runnerProfile.weeklyIntensityOverrides?.[weekNumber] || {}),
                [key]: nextValue,
              },
            },
          },
          weeks: updatedWeeks,
        };
        const savedPlan = await persistPlan(updatedPlan, planName);
        setPlan(savedPlan ?? updatedPlan);
      } catch {
        // Silently fail
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleAdjustRaceDate = async (newRaceDate: string) => {
    if (!plan || !newRaceDate || newRaceDate === plan.runnerProfile.raceDate) return;
    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        raceDate: newRaceDate,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustRaceDistance = async (newRaceDistance: RaceDistanceKey) => {
    if (!plan || newRaceDistance === (plan.runnerProfile.raceDistance ?? "marathon")) return;
    setIsSaving(true);
    try {
      const updatedPlan: MarathonPlan = {
        ...plan,
        runnerProfile: {
          ...plan.runnerProfile,
          raceName: planName.trim() || undefined,
          raceDistance: newRaceDistance,
          racePacingStrategy: pacingStrategy,
          expectedRaceTempF: expectedTempF,
        },
      };
      const savedPlan = await persistPlan(updatedPlan, planName);
      setPlan(savedPlan ?? updatedPlan);
    } catch {
      // Silently fail
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdjustRaceGoalTime = async (newRaceGoalTime: number, raceDistanceMiles: number) => {
    if (!plan || newRaceGoalTime <= 0) return;

    const nextMarathonEquivalentGoal = (newRaceGoalTime / raceDistanceMiles) * 26.2;
    if (Math.abs(nextMarathonEquivalentGoal - plan.runnerProfile.goalMarathonTime) < 0.01) return;

    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        goalMarathonTime: nextMarathonEquivalentGoal,
        racePacingStrategy: pacingStrategy,
        expectedRaceTempF: expectedTempF,
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdjustPacingStrategy = async (newPacingStrategy: PacingStrategy) => {
    if (!plan || newPacingStrategy === (plan.runnerProfile.racePacingStrategy ?? "even")) {
      setPacingStrategy(newPacingStrategy);
      return;
    }

    setPacingStrategy(newPacingStrategy);
    setIsSaving(true);
    try {
      const updatedPlan: MarathonPlan = {
        ...plan,
        runnerProfile: {
          ...plan.runnerProfile,
          raceName: planName.trim() || undefined,
          racePacingStrategy: newPacingStrategy,
          expectedRaceTempF: expectedTempF,
        },
      };
      const savedPlan = await persistPlan(updatedPlan, planName);
      setPlan(savedPlan ?? updatedPlan);
    } catch {
      // Silently fail
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdjustExpectedTemp = async (newExpectedTempF: number) => {
    if (!Number.isFinite(newExpectedTempF)) return;

    const clampedTemp = Math.max(-10, Math.min(110, Math.round(newExpectedTempF)));
    setExpectedTempF(clampedTemp);

    if (!plan || clampedTemp === (plan.runnerProfile.expectedRaceTempF ?? 50)) return;

    setIsSaving(true);
    try {
      const updatedPlan: MarathonPlan = {
        ...plan,
        runnerProfile: {
          ...plan.runnerProfile,
          raceName: planName.trim() || undefined,
          racePacingStrategy: pacingStrategy,
          expectedRaceTempF: clampedTemp,
        },
      };
      const savedPlan = await persistPlan(updatedPlan, planName);
      setPlan(savedPlan ?? updatedPlan);
    } catch {
      // Silently fail
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdjustHeartRate = async (
    key: "maxHeartRate" | "restingHeartRate",
    value: number | null
  ) => {
    if (!plan) return;

    const nextValue = value === null ? null : clampHeartRate(value);
    if ((plan.runnerProfile[key] ?? null) === nextValue) return;

    setIsSaving(true);
    try {
      const updatedPlan: MarathonPlan = {
        ...plan,
        runnerProfile: {
          ...plan.runnerProfile,
          raceName: planName.trim() || undefined,
          [key]: nextValue,
        },
      };
      const savedPlan = await persistPlan(updatedPlan, planName);
      setPlan(savedPlan ?? updatedPlan);
    } catch {
      // Silently fail
    } finally {
      setIsSaving(false);
    }
  };

  const handleWeekUpdate = async (updatedWeek: WeeklyPlan): Promise<void> => {
    if (!plan) return;

    const updatedWeeks = plan.weeks.map((week) =>
      week.weekNumber === updatedWeek.weekNumber ? updatedWeek : week
    );
    const updatedPlan: MarathonPlan = {
      ...plan,
      weeks: updatedWeeks,
      peakWeeklyMileage: Math.max(...updatedWeeks.map((week) => week.totalMileage)),
    };

    setPlan(updatedPlan);

    try {
      const savedPlan = await persistPlan(updatedPlan, planName);
      if (savedPlan) {
        setPlan(savedPlan);
      }
    } catch {
      // Silently fail while keeping in-session edits visible.
    }
  };

  const handleAdjustWeeklyMileage = async (weekNumber: number, mileage: number): Promise<void> => {
    if (!plan) return;

    const targetMileage = Math.max(5, Math.min(120, Math.round(mileage * 4) / 4));
    const currentWeek = plan.weeks.find((week) => week.weekNumber === weekNumber);
    if (!currentWeek || currentWeek.totalMileage === targetMileage) return;

    setIsSaving(true);
    try {
      const profile: RunnerProfile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        weeklyMileageOverrides: {
          ...(plan.runnerProfile.weeklyMileageOverrides ?? {}),
          [weekNumber]: targetMileage,
        },
      };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to recalculate week");

      const regenerated = await response.json() as MarathonPlan;
      regenerated.id = plan.id;
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to recalculate week");
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  const handleAdjustRestDay = async (newRestDay: string) => {
    if (!plan || newRestDay === plan.runnerProfile.preferredRestDay) return;
    setIsLoading(true);
    try {
      const profile = {
        ...plan.runnerProfile,
        raceName: planName.trim() || undefined,
        preferredRestDay: newRestDay,
        preferredDoubleUpDays: (plan.runnerProfile.preferredDoubleUpDays ?? []).filter((day) => day !== newRestDay),
      };
      const nextRunsPerWeek = profile.trainingDaysPerWeek + profile.preferredDoubleUpDays.length;
      profile.runsPerWeekOverride = nextRunsPerWeek;
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      regenerated.id = plan.id;
      setRunsPerWeek(nextRunsPerWeek);
      const savedPlan = await persistPlan(regenerated, planName);
      setPlan(savedPlan ?? regenerated);
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportCalendar = async () => {
    if (!plan) return;

    try {
      const response = await fetch("/api/plan/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });

      if (!response.ok) {
        throw new Error("Failed to export calendar");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `endurlab-plan-${plan.id}.ics`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export calendar");
    }
  };

  const handleCopyPlan = async (planId: string) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/plan/${planId}/copy`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to copy plan");
      await refreshSavedPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy plan");
    } finally {
      setIsSaving(false);
    }
  };

  const handleArchivePlan = async (planId: string, archived: boolean) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/plan/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (!response.ok) throw new Error(archived ? "Failed to archive plan" : "Failed to restore plan");
      await refreshSavedPlans();
      if (archived && plan?.id === planId) {
        setPlan(null);
      }
      if (archived && activePlanId === planId) {
        await persistCurrentPlan(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetCurrentPlan = async (
    planId: string,
    options: { openCurrentPlan?: boolean } = {}
  ): Promise<void> => {
    setError(null);
    const didPersist = await persistCurrentPlan(planId);

    if (didPersist && options.openCurrentPlan) {
      await handleLoadPlan(planId, { focusCurrentSchedule: true });
    }
  };

  useEffect(() => {
    if (isCurrentPlanView) {
      setHasAttemptedCurrentPlanLoad(false);
    }
  }, [isCurrentPlanView, activePlanId]);

  useEffect(() => {
    setAttemptedRequestedPlanId(null);
  }, [requestedPlanId]);

  useEffect(() => {
    const handleOpenCurrentPlan = () => {
      setHasAttemptedCurrentPlanLoad(false);
      setCurrentPlanRequestCount((value) => value + 1);
    };

    window.addEventListener(OPEN_CURRENT_PLAN_EVENT, handleOpenCurrentPlan);
    return () => window.removeEventListener(OPEN_CURRENT_PLAN_EVENT, handleOpenCurrentPlan);
  }, []);

  useEffect(() => {
    if (!requestedPlanId || isCheckingAuth || isLoading || attemptedRequestedPlanId === requestedPlanId) {
      return;
    }

    setAttemptedRequestedPlanId(requestedPlanId);
    if (plan?.id === requestedPlanId) {
      setActivePlanTab(resolvedRequestedPlanTab ?? "overview");
      setPendingCurrentPlanFocus(false);
      return;
    }

    handleLoadPlan(requestedPlanId, {
      updateRoute: false,
      tab: resolvedRequestedPlanTab ?? "overview",
    }).catch(() => {
      // Errors are handled inside handleLoadPlan.
    });
  }, [attemptedRequestedPlanId, isCheckingAuth, isLoading, plan?.id, requestedPlanId, resolvedRequestedPlanTab]);

  useEffect(() => {
    if (!isCurrentPlanView || isCheckingAuth || isLoading || hasAttemptedCurrentPlanLoad) {
      return;
    }

    if (!activePlanId) {
      setHasAttemptedCurrentPlanLoad(true);
      setError("No current plan selected yet.");
      return;
    }

    if (plan?.id === activePlanId) {
      if (resolvedRequestedPlanTab) {
        setActivePlanTab(resolvedRequestedPlanTab);
        setPendingCurrentPlanFocus(false);
      } else {
        focusCurrentSchedule(plan, dailyLogs);
      }
      setHasAttemptedCurrentPlanLoad(true);
      return;
    }

    setHasAttemptedCurrentPlanLoad(true);
    handleLoadPlan(activePlanId, {
      focusCurrentSchedule: !resolvedRequestedPlanTab,
      updateRoute: false,
      tab: resolvedRequestedPlanTab,
    }).catch(() => {
      // Errors are handled inside handleLoadPlan.
    });
  }, [activePlanId, currentPlanRequestCount, dailyLogs, hasAttemptedCurrentPlanLoad, isCheckingAuth, isCurrentPlanView, isLoading, plan, resolvedRequestedPlanTab]);

  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;
    const timeoutId = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => window.clearTimeout(timeoutId);
  }, [activePlanTab, plan]);

  useEffect(() => {
    if (!plan || !resolvedRequestedPlanTab || activePlanTab === resolvedRequestedPlanTab) return;
    setActivePlanTab(resolvedRequestedPlanTab);
    setPendingCurrentPlanFocus(false);
  }, [activePlanTab, plan, resolvedRequestedPlanTab]);

  useEffect(() => {
    if (!pendingCurrentPlanFocus || !plan || activePlanTab !== "schedule") return;

    const timeoutId = window.setTimeout(() => {
      const dayTarget = document.querySelector("[data-focus-day='true']");
      const weekTarget = document.querySelector("[data-current-week-card='true']");
      const target = dayTarget ?? weekTarget;

      if (target instanceof HTMLElement) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      setPendingCurrentPlanFocus(false);
    }, 120);

    return () => window.clearTimeout(timeoutId);
  }, [activePlanTab, pendingCurrentPlanFocus, plan]);

  useEffect(() => {
    if (!activePlanId || savedPlans.length === 0) return;

    const activePlanStillAvailable = savedPlans.some(
      (savedPlan) => !savedPlan.archivedAt && savedPlan.id === activePlanId
    );

    if (!activePlanStillAvailable) {
      persistCurrentPlan(null).catch(() => {
        // Errors are handled inside persistCurrentPlan.
      });
    }
  }, [activePlanId, savedPlans]);

  const handleUpdateShareAccess = async (enabled: boolean): Promise<string | null> => {
    if (!plan) return null;

    setIsSaving(true);
    setShareStatus(null);
    try {
      const response = await fetch(`/api/plan/${plan.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) throw new Error(enabled ? "Failed to create share link" : "Failed to revoke share link");
      const data = (await response.json()) as { shareToken: string | null; shareUrl: string | null };
      setShareToken(data.shareToken);
      setShareLinkUrl(data.shareUrl);
      await refreshSavedPlans();
      setShareStatus(enabled ? "Share link enabled." : "Share link revoked.");
      return data.shareUrl;
    } catch (err) {
      setShareStatus(err instanceof Error ? err.message : "Failed to update share access");
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyShareLink = async (shareUrl: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("Share link copied.");
    } catch {
      setShareStatus("Unable to copy automatically.");
    }
  };

  const toggleWeek = (weekNumber: number) => {
    setExpandedWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(weekNumber)) {
        next.delete(weekNumber);
      } else {
        next.add(weekNumber);
      }
      return next;
    });
  };

  const togglePhase = (phaseKey: string, isExpanded: boolean) => {
    setPhaseExpansionOverrides((current) => ({ ...current, [phaseKey]: !isExpanded }));
  };

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-enduro-200 border-t-enduro-600" />
          <p className="text-lg font-medium text-gray-700">Checking your session...</p>
        </div>
      </div>
    );
  }

  const activeSavedPlans = savedPlans.filter((savedPlan) => !savedPlan.archivedAt);
  const archivedSavedPlans = savedPlans.filter((savedPlan) => savedPlan.archivedAt);

  if ((!plan || isListView) && !isLoading) {
    return (
      <div className="section-padding">
        <div className="container-narrow">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900">{isListView ? "My Plans" : "Generate Your Training Plan"}</h1>
            <p className="mt-2 text-gray-600">
              {isListView
                ? "Pick a saved plan, make one current, or create a new training plan."
                : "Fill in your profile below and we&apos;ll create a personalized marathon plan."}
            </p>
          </div>

          {/* Saved plans list */}
          {savedPlans.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-3">My Plans</h2>
              <div className="space-y-2">
                {activeSavedPlans.map((row) => {
                  const goalMin = row.runnerProfile.goalMarathonTime;
                  const goalStr =
                    goalMin / 60 >= 1
                      ? `${Math.floor(goalMin / 60)}:${String(goalMin % 60).padStart(2, "0")}`
                      : `${goalMin}:00`;
                  const created = new Date(row.createdAt).toLocaleDateString();
                  return (
                    <div
                      key={row.id}
                      className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 hover:border-enduro-300 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-gray-900">
                          {row.raceName || `Goal ${goalStr}`}
                          {activePlanId === row.id && (
                            <span className="rounded-full bg-enduro-100 px-2 py-0.5 text-xs font-semibold text-enduro-700">
                              Current Plan
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-gray-500">
                          {row.planData.totalWeeks} weeks · Peak {row.planData.peakWeeklyMileage} mi/week · Race {formatPlanDate(row.planData.raceDay ?? row.runnerProfile.raceDate)} · Created {created}
                        </p>
                        <PlanSummaryMetrics summary={row.summary} />
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <button
                          onClick={() => handleLoadPlan(row.id)}
                          className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
                        >
                          Load
                        </button>
                        <button
                          onClick={() => handleSetCurrentPlan(row.id, { openCurrentPlan: true })}
                          className={`rounded-lg px-4 py-2 text-sm font-medium ${
                            activePlanId === row.id
                              ? "border border-enduro-200 bg-enduro-50 text-enduro-700"
                              : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                          }`}
                        >
                          {activePlanId === row.id ? "Current" : "Make Current"}
                        </button>
                        <button
                          onClick={() => handleCopyPlan(row.id)}
                          disabled={isSaving}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Copy
                        </button>
                        <button
                          onClick={() => handleArchivePlan(row.id, true)}
                          disabled={isSaving}
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Archive
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {archivedSavedPlans.length > 0 && (
                <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-gray-700">
                    Archived Plans ({archivedSavedPlans.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {archivedSavedPlans.map((row) => {
                      const goalMin = row.runnerProfile.goalMarathonTime;
                      const goalStr =
                        goalMin / 60 >= 1
                          ? `${Math.floor(goalMin / 60)}:${String(goalMin % 60).padStart(2, "0")}`
                          : `${goalMin}:00`;
                      const created = new Date(row.createdAt).toLocaleDateString();
                      return (
                        <div
                          key={row.id}
                          className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900">
                              {row.raceName || `Goal ${goalStr}`}
                            </p>
                            <p className="text-sm text-gray-500">
                              {row.planData.totalWeeks} weeks · Peak {row.planData.peakWeeklyMileage} mi/week · Race {formatPlanDate(row.planData.raceDay ?? row.runnerProfile.raceDate)} · Created {created}
                            </p>
                            <PlanSummaryMetrics summary={row.summary} />
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              onClick={() => handleCopyPlan(row.id)}
                              disabled={isSaving}
                              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Copy
                            </button>
                            <button
                              onClick={() => handleArchivePlan(row.id, false)}
                              disabled={isSaving}
                              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Restore
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          )}

          {!isListView && <OnboardingForm onSubmit={handleGenerate} isLoading={isLoading} />}
          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-enduro-200 border-t-enduro-600" />
          <p className="text-lg font-medium text-gray-700">Generating your plan...</p>
          <p className="text-sm text-gray-500">Calculating pace zones and building weekly schedule</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="section-padding">
        <div className="container-narrow text-center">
          <p className="text-red-600">{error}</p>
          <button
            onClick={() => {
              setPlan(null);
              router.replace("/plan");
            }}
            className="mt-4 rounded-lg bg-enduro-600 px-6 py-2 text-sm font-medium text-white hover:bg-enduro-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Plan display
  if (!plan) return null;
  const currentPaceZones = calculatePaceZones(plan.runnerProfile);
  const currentPowerZones = calculatePowerZones(plan.runnerProfile, currentPaceZones);
  const weeklyLogs = dailyLogsToWeeklyLogs(plan, dailyLogs);
  const progress = analyzeProgress(plan, weeklyLogs);
  const trainingDayCount = plan.runnerProfile.trainingDaysPerWeek;
  const currentRunCount =
    runsPerWeek ??
    (plan.runnerProfile.runsPerWeekOverride
      ? Math.max(3, Math.min(10, plan.runnerProfile.runsPerWeekOverride))
      : trainingDayCount);
  const doubleUpDays = Math.max(0, currentRunCount - trainingDayCount);
  const eligibleDoubleUpDays = plan.weeks[0]?.days
    .filter((day) => !day.isRestDay && !!day.workout)
    .map((day) => day.dayOfWeek) ?? [];
  const inferredDoubleUpDays = plan.weeks[0]?.days
    .filter((day) => !!day.secondaryWorkout)
    .map((day) => day.dayOfWeek) ?? [];
  const preferredDoubleUpDays = plan.runnerProfile.preferredDoubleUpDays ?? [];
  const selectedDoubleUpDays =
    (preferredDoubleUpDays.length === doubleUpDays ? preferredDoubleUpDays : inferredDoubleUpDays)
      .filter((day) => eligibleDoubleUpDays.includes(day));
  const maxDoubleUpDays = Math.min(eligibleDoubleUpDays.length, Math.max(0, 10 - trainingDayCount));
  const selectedRaceDistance =
    RACE_DISTANCES.find((distance) => distance.key === (plan.runnerProfile.raceDistance ?? "marathon")) ??
    RACE_DISTANCES[0];
  const raceGoalPace = plan.runnerProfile.goalMarathonTime / 26.2;
  const selectedRaceGoalTime = raceGoalPace * selectedRaceDistance.miles;
  const selectedRaceGoalInput = formatRaceGoalInput(selectedRaceGoalTime);
  const phaseSections = plan.phases.map((phase) => ({
    phase,
    weeks: plan.weeks.filter(
      (week) => week.weekNumber >= phase.weekRange[0] && week.weekNumber <= phase.weekRange[1]
    ),
  }));
  const recommendedStart = recommendedStartMileage(plan, currentRunCount);
  const actualMileageStep = mileageStepPerBuild(plan.runnerProfile.currentWeeklyMileage, plan.peakWeeklyMileage);
  const recommendedMileageStep = currentRunCount;
  const mileageStepDelta = actualMileageStep - recommendedMileageStep;
  const currentIntensityTargetPercents = getCurrentIntensityTargetPercents(plan.runnerProfile);
  const focusDate = getFocusDate(plan, dailyLogs);
  const currentWeekNumber = focusDate ? getWeekNumberForDate(plan, focusDate) : null;
  const calculatedMaxLongRun = plan.weeks.length > 0
    ? Math.max(...plan.weeks.map((week) => week.longRunDistance))
    : 0;
  const planActivities = garminConnection.activities.filter((activity) => activity.planId === plan.id);
  const runMapActivity = planActivities.find(
    (activity) => activity.id === requestedRunMapActivityId && (activity.sampleCount ?? 0) > 0
  ) ?? null;
  const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const shareUrl = shareLinkUrl ?? (shareToken
    ? `${configuredAppUrl ?? (typeof window !== "undefined" ? window.location.origin : "")}/share/${shareToken}`
    : null);
  void dailyLogRefresh;

  return (
    <div className="section-padding">
      <div className="container-narrow">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-gray-900">Your Marathon Plan</h1>
            <p className="text-gray-600">
              {plan.totalWeeks} weeks · Peak {plan.peakWeeklyMileage} mi/week ·{" "}
              {plan.runnerProfile.goalMarathonTime / 60 >= 1
                ? `${Math.floor(plan.runnerProfile.goalMarathonTime / 60)}:${String(plan.runnerProfile.goalMarathonTime % 60).padStart(2, "0")}`
                : `${plan.runnerProfile.goalMarathonTime}:00`} goal
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="plan-name">
              Plan name
            </label>
            <input
              id="plan-name"
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="Plan name"
              className="h-10 w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 sm:w-56"
            />
            {/* Runs per week control */}
            {runsPerWeek !== null && (
              <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white pr-3">
                <button
                  onClick={() => handleAdjustRunsPerWeek(Math.max(3, runsPerWeek - 1))}
                  disabled={runsPerWeek <= 3 || isLoading}
                  className="px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Decrease runs per week"
                >
                  −
                </button>
                <span className="min-w-[2.5rem] text-center text-sm font-semibold text-gray-900">
                  {runsPerWeek} runs/wk
                </span>
                <button
                  onClick={() => handleAdjustRunsPerWeek(Math.min(10, runsPerWeek + 1))}
                  disabled={runsPerWeek >= 10 || isLoading}
                  className="px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Increase runs per week"
                >
                  +
                </button>
              </div>
            )}
            {/* Weeks control */}
            {weeksOverride !== null && (
              <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white pr-3">
                <button
                  onClick={() => handleAdjustWeeks(Math.max(14, weeksOverride - 1))}
                  disabled={weeksOverride <= 14 || isLoading}
                  className="px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Decrease weeks"
                >
                  −
                </button>
                <span className="min-w-[2.5rem] text-center text-sm font-semibold text-gray-900">
                  {weeksOverride} wks
                </span>
                <button
                  onClick={() => handleAdjustWeeks(Math.min(28, weeksOverride + 1))}
                  disabled={weeksOverride >= 28 || isLoading}
                  className="px-2 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Increase weeks"
                >
                  +
                </button>
              </div>
            )}
            <button
              onClick={handleSavePlan}
              disabled={isSaving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={handleSaveAsNewPlan}
              disabled={isSaving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Save As New
            </button>
            <button
              onClick={handleExportCalendar}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Export Calendar
            </button>
            <button
              onClick={() => {
                setPlan(null);
                setPlanName("");
                router.replace("/plan");
              }}
              className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
            >
              New Plan
            </button>
          </div>
        </div>

        <div className="mb-6 flex rounded-lg bg-gray-100 p-1">
          {[
            { id: "overview", label: "Plan Overview" },
            { id: "schedule", label: "Weekly Schedule" },
            { id: "race", label: "Race Day" },
            { id: "scorecard", label: "Score Card" },
            { id: "settings", label: "Settings" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                const nextTab = tab.id as PlanTab;
                setActivePlanTab(nextTab);
                updatePlanRoute({ tab: nextTab });
              }}
              className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activePlanTab === tab.id
                  ? "bg-white text-enduro-700 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activePlanTab === "overview" ? (
          <>
            {/* Overview + Zones */}
            <div className="mb-8 grid gap-6 lg:grid-cols-3">
              <div id="plan-overview" className="scroll-mt-24 lg:col-span-2">
                <PlanOverviewCard plan={plan} />
              </div>
              <div id="pace-zones" className="scroll-mt-24">
                <PaceZonesCard paceZones={currentPaceZones} powerZones={currentPowerZones} />
              </div>
            </div>

            {/* Charts */}
            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <div id="mileage-trend" className="scroll-mt-24">
                <MileageTrendChart plan={plan} dailyLogs={dailyLogs} activities={garminConnection.activities} />
              </div>
              <div id="long-run-progression" className="scroll-mt-24">
                <LongRunProgressionChart plan={plan} />
              </div>
            </div>
            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <div id="intensity-distribution" className="scroll-mt-24">
                <IntensityDistributionChart plan={plan} />
              </div>
              <div id="run-trend" className="scroll-mt-24">
                <RunTrendChart plan={plan} activities={garminConnection.activities} />
              </div>
            </div>
          </>
        ) : activePlanTab === "schedule" ? (
          <>

            {/* Weekly plan */}
            <div id="weekly-schedule" className="mb-8 scroll-mt-24">
              <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Weekly Schedule</h2>
                  <p className="text-sm text-gray-500">Log actual mileage, completion, feel, and notes inside each day.</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-enduro-50 px-4 py-3">
                    <p className="text-lg font-bold text-enduro-700">{progress.averageFeel || "-"}</p>
                    <p className="text-xs text-enduro-600">Avg Feel</p>
                  </div>
                  <div className="rounded-lg bg-blue-50 px-4 py-3">
                    <p className="text-lg font-bold text-blue-700">{progress.averageAdherence || "-"}%</p>
                    <p className="text-xs text-blue-600">Adherence</p>
                  </div>
                  <div className="rounded-lg bg-purple-50 px-4 py-3">
                    <p className="text-lg font-bold text-purple-700">{progress.projectedPeakMileage || "-"}</p>
                    <p className="text-xs text-purple-600">Projected Peak</p>
                  </div>
                </div>
              </div>
              {progress.adjustmentSuggestions.length > 0 && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-amber-900">Progress Suggestions</h3>
                  <ul className="space-y-1">
                    {progress.adjustmentSuggestions.map((suggestion, index) => (
                      <li key={index} className="text-sm text-amber-800">
                        {suggestion}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-6">
                {phaseSections.map(({ phase, weeks }) => {
                  const phaseKey = phaseExpansionKey(plan.id, phase.weekRange[0]);
                  const isPhaseExpanded = phaseExpansionOverrides[phaseKey] ?? !areAllPhaseRunsLogged(weeks, dailyLogs);
                  const phaseHeadingId = `phase-${phase.weekRange[0]}`;
                  const phaseWeeksId = `phase-weeks-${phase.weekRange[0]}`;

                  return (
                    <section key={phase.name} aria-labelledby={phaseHeadingId} className="space-y-3">
                      <button
                        type="button"
                        onClick={() => togglePhase(phaseKey, isPhaseExpanded)}
                        aria-expanded={isPhaseExpanded}
                        aria-controls={phaseWeeksId}
                        className="w-full rounded-xl border border-enduro-100 bg-enduro-50 p-4 text-left transition-colors hover:border-enduro-200 hover:bg-enduro-100/70"
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-enduro-700">
                                Weeks {phase.weekRange[0]}&ndash;{phase.weekRange[1]}
                              </p>
                              <h3 id={phaseHeadingId} className="mt-1 text-lg font-bold text-gray-900">
                                {phase.name}
                              </h3>
                              <p className="mt-1 max-w-3xl text-sm text-gray-700">{phase.description}</p>
                            </div>
                            <div className="grid gap-2 text-xs text-gray-700 sm:grid-cols-2 md:min-w-72 md:grid-cols-1">
                              {phase.targetMileage && (
                                <span className="rounded-lg bg-white px-3 py-2 shadow-sm">Mileage: {phase.targetMileage}</span>
                              )}
                              {phase.longRunRange && (
                                <span className="rounded-lg bg-white px-3 py-2 shadow-sm">Long runs: {phase.longRunRange}</span>
                              )}
                            </div>
                          </div>
                          <span className={`mt-1 shrink-0 text-gray-500 transition-transform ${isPhaseExpanded ? "rotate-180" : ""}`} aria-hidden="true">
                            ▼
                          </span>
                        </div>
                      </button>
                      {isPhaseExpanded && (
                        <div id={phaseWeeksId} className="space-y-3">
                          {weeks.map((week) => (
                            <WeeklyPlanCard
                              key={week.weekNumber}
                              planId={plan.id}
                              week={week}
                              isExpanded={expandedWeeks.has(week.weekNumber)}
                              onToggle={() => toggleWeek(week.weekNumber)}
                              dailyLogs={dailyLogs}
                              activities={planActivities}
                              onDailyLogSaved={() => setDailyLogRefresh((value) => value + 1)}
                              intensityTargetPercents={currentIntensityTargetPercents}
                              onIntensityTargetChange={handleAdjustIntensityTarget}
                              highlightCurrentWeek={week.weekNumber === currentWeekNumber}
                              focusDate={focusDate}
                              onWeekUpdate={handleWeekUpdate}
                              onMileageChange={handleAdjustWeeklyMileage}
                              onActivityClick={openRunMap}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>

            {/* Adjustment rules */}
            {plan.adjustmentRules.length > 0 && (
              <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50 p-6">
                <h3 className="mb-4 text-lg font-semibold text-amber-900">Adjustment Guidelines</h3>
                <ul className="space-y-3">
                  {plan.adjustmentRules.map((rule, i) => (
                    <li key={i} className="flex gap-3">
                      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                        rule.severity === "high" ? "bg-red-500" :
                        rule.severity === "medium" ? "bg-amber-500" : "bg-green-500"
                      }`} />
                      <div>
                        <p className="text-sm font-medium text-amber-900">{rule.condition}</p>
                        <p className="text-sm text-amber-700">{rule.action}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : activePlanTab === "race" ? (
          <div id="race-day-plan" className="mb-8 scroll-mt-24">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Race Day Plan</h2>
              <div className="flex flex-wrap gap-3">
                <select
                  value={selectedRaceDistance.key}
                  onChange={(e) => handleAdjustRaceDistance(e.target.value as RaceDistanceKey)}
                  disabled={isSaving}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                >
                  {RACE_DISTANCES.map((distance) => (
                    <option key={distance.key} value={distance.key}>
                      {distance.label}
                    </option>
                  ))}
                </select>
                <input
                  key={`race-goal-${selectedRaceDistance.key}-${selectedRaceGoalInput}`}
                  type="text"
                  defaultValue={selectedRaceGoalInput}
                  aria-label={`${selectedRaceDistance.label} goal time`}
                  onBlur={(e) => {
                    const parsedTime = parseRaceGoalInput(e.target.value);
                    if (parsedTime === null) {
                      e.target.value = selectedRaceGoalInput;
                      return;
                    }
                    handleAdjustRaceGoalTime(parsedTime, selectedRaceDistance.miles);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.currentTarget.value = selectedRaceGoalInput;
                      e.currentTarget.blur();
                    }
                  }}
                  disabled={isLoading}
                  className="w-28 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                />
                <input
                  type="date"
                  value={plan.runnerProfile.raceDate.slice(0, 10)}
                  onChange={(e) => handleAdjustRaceDate(e.target.value)}
                  disabled={isLoading}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                />
                <select
                  value={pacingStrategy}
                  onChange={(e) => handleAdjustPacingStrategy(e.target.value as PacingStrategy)}
                  disabled={isSaving}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                >
                  <option value="even">Even Pacing</option>
                  <option value="negative">Negative Split</option>
                  <option value="progressive">Progressive</option>
                  <option value="positive">Positive Split</option>
                </select>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-gray-600">Temp (F):</label>
                  <input
                    type="number"
                    value={expectedTempF}
                    onChange={(e) => setExpectedTempF(parseInt(e.target.value, 10) || 50)}
                    onBlur={(e) => handleAdjustExpectedTemp(parseInt(e.target.value, 10))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    min="-10"
                    max="110"
                    className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center text-sm focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                  />
                </div>
              </div>
            </div>
            <RaceDayPlanCard
              plan={generateRaceDayPlan(
                selectedRaceGoalTime,
                plan.runnerProfile.raceDate,
                expectedTempF,
                pacingStrategy,
                selectedRaceDistance.miles,
                selectedRaceDistance.label
              )}
            />
          </div>
        ) : activePlanTab === "scorecard" ? (
          <div id="scorecard" className="mb-8 scroll-mt-24">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Sub-3 Score Card</h2>
              <p className="text-sm text-gray-500">
                Objective markers scored against the generated plan and logged actuals.
              </p>
            </div>
            <Sub3Scorecard plan={plan} dailyLogs={dailyLogs} />
          </div>
        ) : (
          <div className="mb-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Plan Settings</h2>
              <p className="text-sm text-gray-500">Changes regenerate and save the current plan.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <GarminSyncCard
                planId={plan.id}
                connection={garminConnection}
                onChanged={refreshGarminConnection}
              />
              <div id="mileage-targets" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 md:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Mileage targets</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      The plan starts at Start mileage and scales to Peak mileage. Each build step represents one three-week mileage increase.
                    </p>
                    <p className="mt-2 text-xs text-gray-500">
                      Required step: {actualMileageStep.toFixed(1)} mi every three weeks. Recommended step: {recommendedMileageStep.toFixed(1)} mi every three weeks ({currentRunCount} runs/week x 1 mi/run).{" "}
                      {Math.abs(mileageStepDelta) < 0.1
                        ? "This matches the recommendation."
                        : mileageStepDelta > 0
                          ? `${mileageStepDelta.toFixed(1)} mi above recommended.`
                          : `${Math.abs(mileageStepDelta).toFixed(1)} mi below recommended.`}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Recommended start for this peak: {recommendedStart} mi/week.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4 lg:min-w-[42rem]">
                    <label className="block">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Start</span>
                      <input
                        key={`start-${plan.runnerProfile.currentWeeklyMileage}`}
                        type="number"
                        min={5}
                        max={120}
                        defaultValue={plan.runnerProfile.currentWeeklyMileage}
                        onBlur={(e) => handleAdjustStartMileage(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        disabled={isLoading}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Peak</span>
                      <input
                        key={`peak-${plan.peakWeeklyMileage}`}
                        type="number"
                        min={10}
                        max={120}
                        defaultValue={plan.peakWeeklyMileage}
                        onBlur={(e) => handleAdjustPeakMileage(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        disabled={isLoading}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Max long run</span>
                      <input
                        key={`max-long-${calculatedMaxLongRun}`}
                        type="number"
                        min={4}
                        max={30}
                        step={0.5}
                        defaultValue={calculatedMaxLongRun}
                        onBlur={(e) => handleAdjustMaxLongRun(Number(e.target.value))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        disabled={isLoading}
                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => handleAdjustStartMileage(recommendedStart)}
                      disabled={isLoading || recommendedStart === plan.runnerProfile.currentWeeklyMileage}
                      className="self-end rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
                    >
                      Use recommended start
                    </button>
                  </div>
                </div>
              </div>

              <div id="intensity-targets" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 md:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Intensity targets</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Weekly workout construction targets these percentages where the phase allows it. Extra marathon-pace volume is added to the end of the long run.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[36rem]">
                    {[
                      { key: "marathon" as const, label: "Specific endurance", sublabel: "Marathon pace", range: "8-15%" },
                      { key: "threshold" as const, label: "Threshold / LT", sublabel: "Sustained strength", range: "5-8%" },
                      { key: "vo2" as const, label: "VO2max / Speed", sublabel: "Economy maintenance", range: "1-4%" },
                    ].map((target) => (
                      <label key={target.key} className="block rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{target.label}</span>
                        <span className="mt-1 block text-xs text-gray-500">{target.sublabel} · {target.range}</span>
                        <input
                          key={`intensity-${target.key}-${currentIntensityTargetPercents[target.key]}`}
                          type="number"
                          min={INTENSITY_TARGET_RANGES[target.key].min}
                          max={INTENSITY_TARGET_RANGES[target.key].max}
                          step={0.5}
                          defaultValue={currentIntensityTargetPercents[target.key]}
                          onBlur={(e) => handleAdjustIntensityTarget(target.key, Number(e.target.value))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          disabled={isLoading}
                          className="mt-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div id="heart-rate-anchors" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5">
                <p className="block text-sm font-semibold text-gray-900">
                  Heart rate anchors
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Used to calculate heart-rate targets in the pace zones card with the HRR formula.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Resting HR</span>
                    <input
                      key={`resting-hr-${plan.runnerProfile.restingHeartRate ?? "unset"}`}
                      type="number"
                      min={30}
                      max={120}
                      defaultValue={plan.runnerProfile.restingHeartRate ?? ""}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        handleAdjustHeartRate("restingHeartRate", value ? Number(value) : null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      disabled={isSaving}
                      placeholder="e.g. 50"
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Max HR</span>
                    <input
                      key={`max-hr-${plan.runnerProfile.maxHeartRate ?? "unset"}`}
                      type="number"
                      min={100}
                      max={240}
                      defaultValue={plan.runnerProfile.maxHeartRate ?? ""}
                      onBlur={(e) => {
                        const value = e.target.value.trim();
                        handleAdjustHeartRate("maxHeartRate", value ? Number(value) : null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      disabled={isSaving}
                      placeholder="e.g. 190"
                      className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                    />
                  </label>
                </div>
              </div>

              <div id="rest-day-settings" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5">
                <label htmlFor="rest-day" className="block text-sm font-semibold text-gray-900">
                  Rest day
                </label>
                <p className="mt-1 text-sm text-gray-500">
                  Long run day: {plan.runnerProfile.availableLongRunDays[0] ?? "Sunday"}
                </p>
                <select
                  id="rest-day"
                  value={plan.runnerProfile.preferredRestDay}
                  onChange={(e) => handleAdjustRestDay(e.target.value)}
                  disabled={isLoading}
                  className="mt-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                >
                  {DAYS_OF_WEEK.map((day) => {
                    const isLongRunDay = day === (plan.runnerProfile.availableLongRunDays[0] ?? "Sunday");
                    return (
                      <option key={day} value={day} disabled={isLongRunDay}>
                        {day}{isLongRunDay ? " (long run)" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div id="double-up-days" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5">
                <p className="block text-sm font-semibold text-gray-900">
                  Double-up days
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {trainingDayCount} training days, {currentRunCount} total runs per week. Select days for secondary easy runs.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {eligibleDoubleUpDays.map((day) => {
                    const isSelected = selectedDoubleUpDays.includes(day);
                    const wouldExceedLimit = !isSelected && selectedDoubleUpDays.length >= maxDoubleUpDays;

                    return (
                      <label
                        key={day}
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                          isSelected
                            ? "border-enduro-300 bg-enduro-50 text-enduro-800"
                            : "border-gray-200 bg-white text-gray-700"
                        } ${isLoading || wouldExceedLimit ? "opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isLoading || wouldExceedLimit}
                          onChange={(e) => {
                            const nextDays = e.target.checked
                              ? [...selectedDoubleUpDays, day]
                              : selectedDoubleUpDays.filter((selectedDay) => selectedDay !== day);
                            handleAdjustDoubleUpDays(nextDays);
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-enduro-600 focus:ring-enduro-500"
                        />
                        {day}
                      </label>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  {selectedDoubleUpDays.length === 0 ? "No double-up days selected." : `${selectedDoubleUpDays.length} double-up ${selectedDoubleUpDays.length === 1 ? "day" : "days"} selected.`}
                </p>
              </div>

              <div id="share-access" className="scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5 md:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Share access</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Create a random public URL for read-only access to this plan. Revoke access at any time.
                    </p>
                    {shareStatus && (
                      <p className={`mt-2 text-xs ${shareStatus.includes("Failed") || shareStatus.includes("Unable") ? "text-red-600" : "text-enduro-700"}`}>
                        {shareStatus}
                      </p>
                    )}
                  </div>
                  <div className="w-full space-y-3 lg:max-w-xl">
                    {shareUrl ? (
                      <>
                        <label className="block">
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Read-only share link</span>
                          <input
                            type="text"
                            readOnly
                            value={shareUrl}
                            className="mt-1 w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyShareLink(shareUrl)}
                            disabled={isSaving}
                            className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
                          >
                            Copy Link
                          </button>
                          <a
                            href={shareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Open Read-Only View
                          </a>
                          <button
                            type="button"
                            onClick={() => handleUpdateShareAccess(false)}
                            disabled={isSaving}
                            className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            Revoke Access
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleUpdateShareAccess(true)}
                        disabled={isSaving}
                        className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
                      >
                        Create Share Link
                      </button>
                     )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {runMapActivity && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm"
          onClick={closeRunMap}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="my-8 max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-950 text-[10px] font-black text-white">G</span>
                <span className="text-sm font-semibold text-gray-900">Run Map</span>
              </div>
              <button
                type="button"
                onClick={closeRunMap}
                className="rounded-md px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900"
              >
                ✕ Close
              </button>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-y-auto">
              <GarminActivityMapCard
                activities={planActivities}
                activityId={runMapActivity.id}
                onActivityChange={(activityId) => updatePlanRoute({ runmap: activityId })}
                shareBaseUrl={shareUrl}
                onCreateShareLink={() => handleUpdateShareAccess(true)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
