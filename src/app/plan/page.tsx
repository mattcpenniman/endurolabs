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
import { RunnerProfile, MarathonPlan } from "@/lib/training/models";
import OnboardingForm from "@/app/components/onboarding/OnboardingForm";
import PlanOverviewCard from "@/app/components/plan/PlanOverviewCard";
import PaceZonesCard from "@/app/components/plan/PaceZonesCard";
import WeeklyPlanCard from "@/app/components/plan/WeeklyPlanCard";
import RaceDayPlanCard from "@/app/components/plan/RaceDayPlanCard";
import Sub3Scorecard from "@/app/components/plan/Sub3Scorecard";
import MileageTrendChart from "@/app/components/charts/MileageTrendChart";
import LongRunProgressionChart from "@/app/components/charts/LongRunProgressionChart";
import IntensityDistributionChart from "@/app/components/charts/IntensityDistributionChart";
import { generateRaceDayPlan } from "@/lib/training/race-day-plan";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { analyzeProgress, dailyLogsToWeeklyLogs, loadDailyLogs } from "@/lib/training/progress-tracker";

// Shape of a saved plan row from the database
interface SavedPlanRow {
  id: string;
  runnerProfile: RunnerProfile;
  planData: MarathonPlan;
  peakMileageOverride: number | null;
  weeksOverride: number | null;
  raceName: string | null;
  createdAt: string;
}

interface SavePlanResponse {
  success: boolean;
  id: string;
  planData: MarathonPlan;
}

type PlanTab = "overview" | "schedule" | "race" | "scorecard" | "settings";
type RaceDistanceKey = NonNullable<RunnerProfile["raceDistance"]>;

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const RACE_DISTANCES: Array<{ key: RaceDistanceKey; label: string; miles: number }> = [
  { key: "marathon", label: "Marathon", miles: 26.2 },
  { key: "half_marathon", label: "Half Marathon", miles: 13.1 },
  { key: "10k", label: "10K", miles: 6.2 },
  { key: "5k", label: "5K", miles: 3.1 },
];

function clampMileage(value: number): number {
  if (!Number.isFinite(value)) return 5;
  return Math.max(5, Math.min(120, Math.round(value)));
}

function recommendedStartMileage(plan: MarathonPlan, runsPerWeek: number): number {
  if (plan.weeks.length === 0) {
    return clampMileage(plan.runnerProfile.currentWeeklyMileage);
  }
  const peakWeek = plan.weeks.reduce(
    (best, week) => (week.totalMileage > best.totalMileage ? week : best),
    plan.weeks[0]!
  );
  const weeksToPeak = Math.max(0, (peakWeek?.weekNumber ?? plan.totalWeeks) - 1);
  const threeWeekBuilds = Math.floor(weeksToPeak / 3);
  const buildCapacity = Math.max(0, runsPerWeek * threeWeekBuilds);
  return clampMileage(plan.peakWeeklyMileage - buildCapacity);
}

export default function PlanPage(): React.ReactNode {
  const [plan, setPlan] = useState<MarathonPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pacingStrategy, setPacingStrategy] = useState<"even" | "negative" | "positive" | "progressive">("even");
  const [expectedTempF, setExpectedTempF] = useState(50);
  const [savedPlans, setSavedPlans] = useState<SavedPlanRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [runsPerWeek, setRunsPerWeek] = useState<number | null>(null);
  const [weeksOverride, setWeeksOverride] = useState<number | null>(null);
  const [planName, setPlanName] = useState("");
  const [activePlanTab, setActivePlanTab] = useState<PlanTab>("overview");
  const [dailyLogRefresh, setDailyLogRefresh] = useState(0);

  // Load saved plans on mount
  useEffect(() => {
    fetch("/api/plan/list")
      .then((res) => res.json())
      .then((data) => setSavedPlans(data))
      .catch(() => setSavedPlans([]));
  }, []);

  const refreshSavedPlans = async (): Promise<void> => {
    const listRes = await fetch("/api/plan/list");
    if (listRes.ok) {
      setSavedPlans(await listRes.json());
    }
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

      setPlan(savedPlan ?? generatedPlan);
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
      }
    } catch {
      // Silently fail — plan is still usable in session
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadPlan = async (planId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/plan/${planId}`);
      if (!res.ok) throw new Error("Failed to load plan");
      const saved = await res.json();
      setPlan(saved.planData);
      setPlanName(saved.raceName ?? saved.runnerProfile.raceName ?? "");
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
      setPlan(savedPlan ?? regenerated);
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

  if (!plan && !isLoading) {
    return (
      <div className="section-padding">
        <div className="container-narrow">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900">Generate Your Training Plan</h1>
            <p className="mt-2 text-gray-600">
              Fill in your profile below and we&apos;ll create a personalized marathon plan.
            </p>
          </div>

          {/* Saved plans list */}
          {savedPlans.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-gray-800 mb-3">Saved Plans</h2>
              <div className="space-y-2">
                {savedPlans.map((row) => {
                  const goalMin = row.runnerProfile.goalMarathonTime;
                  const goalStr =
                    goalMin / 60 >= 1
                      ? `${Math.floor(goalMin / 60)}:${String(goalMin % 60).padStart(2, "0")}`
                      : `${goalMin}:00`;
                  const created = new Date(row.createdAt).toLocaleDateString();
                  return (
                    <div
                      key={row.id}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-enduro-300"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {row.raceName || `Goal ${goalStr}`}
                        </p>
                        <p className="text-sm text-gray-500">
                          {row.planData.totalWeeks} weeks · Peak {row.planData.peakWeeklyMileage} mi/week · Created {created}
                        </p>
                      </div>
                      <button
                        onClick={() => handleLoadPlan(row.id)}
                        className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
                      >
                        Load
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <OnboardingForm onSubmit={handleGenerate} isLoading={isLoading} />
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
            onClick={() => setPlan(null)}
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
  const dailyLogs = loadDailyLogs(plan.id);
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
  const phaseSections = plan.phases.map((phase) => ({
    phase,
    weeks: plan.weeks.filter(
      (week) => week.weekNumber >= phase.weekRange[0] && week.weekNumber <= phase.weekRange[1]
    ),
  }));
  const recommendedStart = recommendedStartMileage(plan, currentRunCount);
  const peakWeekNumber = plan.weeks.length > 0
    ? plan.weeks.reduce(
        (best, week) => (week.totalMileage > best.totalMileage ? week : best),
        plan.weeks[0]!
      ).weekNumber
    : plan.totalWeeks;
  const weeksToPeak = Math.max(0, peakWeekNumber - 1);
  const threeWeekBuilds = Math.floor(weeksToPeak / 3);
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
              onClick={() => setActivePlanTab(tab.id as PlanTab)}
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
              <div className="lg:col-span-2">
                <PlanOverviewCard plan={plan} />
              </div>
              <div>
                <PaceZonesCard paceZones={currentPaceZones} powerZones={currentPowerZones} />
              </div>
            </div>

            {/* Charts */}
            <div className="mb-8 grid gap-6 lg:grid-cols-2">
              <MileageTrendChart plan={plan} dailyLogs={dailyLogs} />
              <LongRunProgressionChart plan={plan} />
            </div>
            <div className="mb-8">
              <IntensityDistributionChart plan={plan} />
            </div>
          </>
        ) : activePlanTab === "schedule" ? (
          <>

            {/* Weekly plan */}
            <div className="mb-8">
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
                {phaseSections.map(({ phase, weeks }) => (
                  <section key={phase.name} aria-labelledby={`phase-${phase.weekRange[0]}`} className="space-y-3">
                    <div className="rounded-xl border border-enduro-100 bg-enduro-50 p-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-enduro-700">
                            Weeks {phase.weekRange[0]}&ndash;{phase.weekRange[1]}
                          </p>
                          <h3 id={`phase-${phase.weekRange[0]}`} className="mt-1 text-lg font-bold text-gray-900">
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
                    </div>
                    {weeks.map((week) => (
                      <WeeklyPlanCard
                        key={week.weekNumber}
                        planId={plan.id}
                        week={week}
                        isExpanded={expandedWeeks.has(week.weekNumber)}
                        onToggle={() => toggleWeek(week.weekNumber)}
                        dailyLogs={dailyLogs}
                        onDailyLogSaved={() => setDailyLogRefresh((value) => value + 1)}
                      />
                    ))}
                  </section>
                ))}
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
          <div className="mb-8">
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
                  type="date"
                  value={plan.runnerProfile.raceDate.slice(0, 10)}
                  onChange={(e) => handleAdjustRaceDate(e.target.value)}
                  disabled={isLoading}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20 disabled:opacity-60"
                />
                <select
                  value={pacingStrategy}
                  onChange={(e) => setPacingStrategy(e.target.value as typeof pacingStrategy)}
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
                    onChange={(e) => setExpectedTempF(parseInt(e.target.value) || 50)}
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
          <div className="mb-8">
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
              <div className="rounded-lg border border-gray-200 bg-white p-5 md:col-span-2">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Mileage targets</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Start recommendation back-calculates from peak using +1 mile per run every three weeks.
                    </p>
                    <p className="mt-2 text-xs text-gray-500">
                      Recommended start: {recommendedStart} mi/week from {plan.peakWeeklyMileage} peak mi/week, {currentRunCount} runs/week, and {threeWeekBuilds} three-week build {threeWeekBuilds === 1 ? "block" : "blocks"} before peak week {peakWeekNumber}.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[34rem]">
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

              <div className="rounded-lg border border-gray-200 bg-white p-5">
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

              <div className="rounded-lg border border-gray-200 bg-white p-5">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
