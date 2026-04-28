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
import { RunnerProfile, MarathonPlan, RaceDayPlan } from "@/lib/training/models";
import OnboardingForm from "@/app/components/onboarding/OnboardingForm";
import PlanOverviewCard from "@/app/components/plan/PlanOverviewCard";
import PaceZonesCard from "@/app/components/plan/PaceZonesCard";
import WeeklyPlanCard from "@/app/components/plan/WeeklyPlanCard";
import RaceDayPlanCard from "@/app/components/plan/RaceDayPlanCard";
import WeeklyProgressTracker from "@/app/components/plan/WeeklyProgressTracker";
import MileageTrendChart from "@/app/components/charts/MileageTrendChart";
import LongRunProgressionChart from "@/app/components/charts/LongRunProgressionChart";
import IntensityDistributionChart from "@/app/components/charts/IntensityDistributionChart";
import { generateRaceDayPlan } from "@/lib/training/race-day-plan";

// Shape of a saved plan row from the database
interface SavedPlanRow {
  id: string;
  runnerProfile: RunnerProfile;
  planData: MarathonPlan;
  peakMileageOverride: number | null;
  weeksOverride: number | null;
  raceName: string | null;
  created_at: string;
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

  // Load saved plans on mount
  useEffect(() => {
    fetch("/api/plan/list")
      .then((res) => res.json())
      .then((data) => setSavedPlans(data))
      .catch(() => setSavedPlans([]));
  }, []);

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

      // Auto-save to database
      const saveRes = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: generatedPlan.id,
          runnerProfile: generatedPlan.runnerProfile,
          planData: generatedPlan,
          peakMileageOverride: profile.peakMileageOverride,
          weeksOverride: profile.weeksOverride,
          raceName: profile.raceName || null,
        }),
      });

      if (saveRes.ok) {
        const saveData = await saveRes.json();
        // Refresh saved plans list
        const listRes = await fetch("/api/plan/list");
        if (listRes.ok) {
          setSavedPlans(await listRes.json());
        }
      }

      setPlan(generatedPlan);
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
      await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          runnerProfile: plan.runnerProfile,
          planData: plan,
          peakMileageOverride: plan.runnerProfile.peakMileageOverride,
          weeksOverride: plan.runnerProfile.weeksOverride,
          raceName: plan.runnerProfile.raceName || null,
        }),
      });
      // Refresh list
      const listRes = await fetch("/api/plan/list");
      if (listRes.ok) {
        setSavedPlans(await listRes.json());
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
      const profile = { ...plan.runnerProfile, runsPerWeekOverride: newRuns };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      setPlan(regenerated);
      setRunsPerWeek(newRuns);
      // Auto-save
      const saveRes = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: regenerated.id,
          runnerProfile: regenerated.runnerProfile,
          planData: regenerated,
          peakMileageOverride: profile.peakMileageOverride,
          weeksOverride: profile.weeksOverride,
          raceName: profile.raceName || null,
        }),
      });
      if (saveRes.ok) {
        const listRes = await fetch("/api/plan/list");
        if (listRes.ok) setSavedPlans(await listRes.json());
      }
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
      const profile = { ...plan.runnerProfile, weeksOverride: newWeeks };
      const response = await fetch("/api/plan/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (!response.ok) throw new Error("Failed to regenerate plan");
      const regenerated = await response.json();
      setPlan(regenerated);
      setWeeksOverride(newWeeks);
      // Auto-save
      const saveRes = await fetch("/api/plan/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: regenerated.id,
          runnerProfile: regenerated.runnerProfile,
          planData: regenerated,
          peakMileageOverride: profile.peakMileageOverride,
          weeksOverride: profile.weeksOverride,
          raceName: profile.raceName || null,
        }),
      });
      if (saveRes.ok) {
        const listRes = await fetch("/api/plan/list");
        if (listRes.ok) setSavedPlans(await listRes.json());
      }
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
                  const created = new Date(row.created_at).toLocaleDateString();
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

  return (
    <div className="section-padding">
      <div className="container-narrow">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Your Marathon Plan</h1>
            <p className="text-gray-600">
              {plan.totalWeeks} weeks · Peak {plan.peakWeeklyMileage} mi/week ·{" "}
              {plan.runnerProfile.goalMarathonTime / 60 >= 1
                ? `${Math.floor(plan.runnerProfile.goalMarathonTime / 60)}:${String(plan.runnerProfile.goalMarathonTime % 60).padStart(2, "0")}`
                : `${plan.runnerProfile.goalMarathonTime}:00`} goal
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              💾 Save
            </button>
            <button
              onClick={handleExportCalendar}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              📅 Export Calendar
            </button>
            <button
              onClick={() => setPlan(null)}
              className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
            >
              New Plan
            </button>
          </div>
        </div>

        {/* Overview + Zones */}
        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PlanOverviewCard plan={plan} />
          </div>
          <div>
            <PaceZonesCard paceZones={plan.paceZones} powerZones={plan.powerZones} />
          </div>
        </div>

        {/* Charts */}
        <div className="mb-8 grid gap-6 lg:grid-cols-2">
          <MileageTrendChart plan={plan} />
          <LongRunProgressionChart plan={plan} />
        </div>
        <div className="mb-8">
          <IntensityDistributionChart plan={plan} />
        </div>

        {/* Race Day Plan */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">Race Day Plan</h2>
            <div className="flex gap-3">
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
                <label className="text-sm text-gray-600">Temp (°F):</label>
                <input
                  type="number"
                  value={expectedTempF}
                  onChange={(e) => setExpectedTempF(parseInt(e.target.value) || 50)}
                  min="-10"
                  max="110"
                  className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-sm text-center focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>
            </div>
          </div>
          {plan && (
            <RaceDayPlanCard
              plan={generateRaceDayPlan(
                plan.runnerProfile.goalMarathonTime,
                plan.runnerProfile.raceDate,
                expectedTempF,
                pacingStrategy
              )}
            />
          )}
        </div>

        {/* Weekly progress tracker */}
        <div className="mb-8">
          <WeeklyProgressTracker plan={plan} />
        </div>

        {/* Weekly plan */}
        <div className="mb-8">
          <h2 className="mb-4 text-2xl font-bold text-gray-900">Weekly Schedule</h2>
          <div className="space-y-3">
            {plan.weeks.map((week) => (
              <WeeklyPlanCard
                key={week.weekNumber}
                week={week}
                isExpanded={expandedWeeks.has(week.weekNumber)}
                onToggle={() => toggleWeek(week.weekNumber)}
              />
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
      </div>
    </div>
  );
}
