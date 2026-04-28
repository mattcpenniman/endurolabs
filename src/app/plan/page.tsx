"use client";

// ============================================================
// EnduroLab — Plan Page
// ============================================================
// Client page that handles onboarding form submission,
// calls the plan generation API, and renders the full
// plan with charts, weekly cards, and calendar export.
// ============================================================

import React from "react";
import { useState } from "react";
import { RunnerProfile, MarathonPlan } from "@/lib/training/models";
import OnboardingForm from "@/app/components/onboarding/OnboardingForm";
import PlanOverviewCard from "@/app/components/plan/PlanOverviewCard";
import PaceZonesCard from "@/app/components/plan/PaceZonesCard";
import WeeklyPlanCard from "@/app/components/plan/WeeklyPlanCard";
import MileageTrendChart from "@/app/components/charts/MileageTrendChart";
import LongRunProgressionChart from "@/app/components/charts/LongRunProgressionChart";
import IntensityDistributionChart from "@/app/components/charts/IntensityDistributionChart";

export default function PlanPage(): React.ReactNode {
  const [plan, setPlan] = useState<MarathonPlan | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

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
      setPlan(generatedPlan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
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
          <div className="flex gap-2">
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
