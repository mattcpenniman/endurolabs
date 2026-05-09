// ============================================================
// EnduroLab — Public Shared Plan Page
// ============================================================
// Read-only plan view addressed by a random share token.
// ============================================================

import React from "react";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { plans } from "@/lib/db/schema";
import PlanOverviewCard from "@/app/components/plan/PlanOverviewCard";
import PaceZonesCard from "@/app/components/plan/PaceZonesCard";
import { calculatePaceZones, calculatePowerZones } from "@/lib/training/zone-calculator";
import { MarathonPlan, RunnerProfile, Workout, formatPace } from "@/lib/training/models";

function formatShortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatMiles(distance: number): string {
  return Number.isInteger(distance) ? `${distance}` : `${distance.toFixed(2).replace(/0$/, "")}`;
}

function segmentDistanceLabel(segment: Workout["segments"][number]): string {
  if (!segment.distance) return segment.duration ? `${segment.duration} min` : "";
  if (segment.repetitions && segment.repetitions > 1) {
    return `${segment.repetitions} x ${formatMiles(segment.distance)} mi`;
  }
  return `${formatMiles(segment.distance)} mi`;
}

export default async function SharedPlanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<React.ReactNode> {
  const { token } = await params;

  const [sharedPlan] = await db
    .select()
    .from(plans)
    .where(eq(plans.shareToken, token))
    .limit(1);

  if (!sharedPlan?.shareToken) {
    notFound();
  }

  const storedPlan = sharedPlan.planData as MarathonPlan;
  const runnerProfile = (storedPlan.runnerProfile ?? sharedPlan.runnerProfile) as RunnerProfile;
  const paceZones = calculatePaceZones(runnerProfile);
  const plan: MarathonPlan = {
    ...storedPlan,
    runnerProfile,
    paceZones,
    powerZones: calculatePowerZones(runnerProfile, paceZones),
  };
  const planTitle = runnerProfile.raceName?.trim() || "Shared Marathon Plan";

  return (
    <main className="section-padding">
      <div className="container-narrow">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-enduro-700">Read-only shared plan</p>
          <h1 className="mt-1 text-3xl font-bold text-gray-900">{planTitle}</h1>
          <p className="mt-2 text-gray-600">
            {plan.totalWeeks} weeks · Peak {plan.peakWeeklyMileage} mi/week · Race day {formatShortDate(plan.raceDay)}
          </p>
        </div>

        <div className="mb-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PlanOverviewCard plan={plan} />
          </div>
          <PaceZonesCard paceZones={plan.paceZones} powerZones={plan.powerZones} />
        </div>

        <section className="mb-8">
          <div className="mb-4">
            <h2 className="text-2xl font-bold text-gray-900">Weekly Schedule</h2>
            <p className="text-sm text-gray-500">Read-only view. Workout edits and logs are available only to the plan owner.</p>
          </div>

          <div className="space-y-4">
            {plan.weeks.map((week) => (
              <details key={week.weekNumber} className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 hover:bg-gray-50 sm:flex-row sm:items-start sm:justify-between [&::-webkit-details-marker]:hidden">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-700">
                          Week {week.weekNumber}
                        </span>
                        {week.isDownWeek && (
                          <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-bold text-green-700">
                            Recovery Week
                          </span>
                        )}
                        <span className="text-sm font-medium text-gray-800">
                          Starts {formatShortDate(week.startDate)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-gray-600">
                        {formatMiles(week.totalMileage)} mi total · Long {formatMiles(week.longRunDistance)} mi
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-green-50 px-2 py-1 text-green-700">
                        Easy {formatMiles(week.intensityDistribution.easy)} mi
                      </span>
                      <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">
                        T {formatMiles(week.intensityDistribution.threshold)} mi
                      </span>
                      <span className="rounded bg-blue-50 px-2 py-1 text-blue-700">
                        MP {formatMiles(week.intensityDistribution.marathon)} mi
                      </span>
                      <span className="rounded bg-red-50 px-2 py-1 text-red-700">
                        VO2 {formatMiles(week.intensityDistribution.vo2)} mi
                      </span>
                      <span className="ml-1 text-gray-400 transition-transform group-open:rotate-180">▼</span>
                    </div>
                </summary>

                <div className="divide-y divide-gray-50 border-t border-gray-100 px-4 pb-4">
                  {week.days.map((day) => (
                    <div key={`${week.weekNumber}-${day.dayOfWeek}`} className="grid gap-3 py-3 md:grid-cols-[6rem_1fr]">
                      <div>
                        <p className="text-xs font-medium text-gray-500">{day.dayOfWeek.slice(0, 3)}</p>
                        <p className="text-xs text-gray-400">{formatShortDate(day.date)}</p>
                      </div>
                      {day.workout ? (
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {day.workout.title}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatMiles(day.workout.totalDistance)} mi · {Math.floor(day.workout.estimatedDuration / 60)}h {day.workout.estimatedDuration % 60}min
                          </p>
                          {day.workout.segments.length > 1 && (
                            <div className="mt-2 grid gap-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                              {day.workout.segments.map((segment, index) => (
                                <div key={`${day.workout?.id}-${index}`} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <span>
                                    {segment.description}
                                    {segment.pace && <span className="ml-2 text-gray-400">@ {formatPace(segment.pace)}/mi</span>}
                                  </span>
                                  <span className="font-semibold text-gray-700">{segmentDistanceLabel(segment)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-400">Rest</p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
