"use client";

// ============================================================
// EnduroLab — Onboarding Form
// ============================================================
// Multi-step form for collecting runner profile data.
// Persists state across steps, submits to the plan API.
// ============================================================

import React from "react";
import { useState } from "react";
import { RunnerProfile } from "@/lib/training/models";

interface OnboardingFormProps {
  onSubmit: (profile: RunnerProfile) => void;
  isLoading: boolean;
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// Validate runner profile for common inconsistencies
function validateProfile(profile: RunnerProfile): string[] {
  const warnings: string[] = [];

  if (profile.peakHistoricalWeeklyMileage < profile.currentWeeklyMileage) {
    warnings.push("Peak weekly mileage is lower than your current mileage — peak should be ≥ current.");
  }
  if (profile.longestRecentLongRun > profile.currentWeeklyMileage) {
    warnings.push("Longest run exceeds your current weekly mileage — that doesn't add up.");
  }
  if (profile.currentMarathonPR && profile.currentMarathonPR < profile.goalMarathonTime) {
    warnings.push("Your marathon PR is faster than your goal time — consider setting a more ambitious goal or using your PR as the goal.");
  }
  if (profile.longestRecentLongRun < 4) {
    warnings.push("Longest recent run is under 4 miles — you may want to build up to longer runs before starting a marathon plan.");
  }
  if (profile.currentWeeklyMileage < 10) {
    warnings.push("Current weekly mileage is under 10 mi — marathon training will require a significant build-up. Consider a couch-to-5K plan first.");
  }

  return warnings;
}

export default function OnboardingForm({ onSubmit, isLoading }: OnboardingFormProps) {
  const [step, setStep] = useState(1);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Step 1: Goal & timing
  const [goalTime, setGoalTime] = useState({ hours: 4, minutes: 0 });
  const [raceDate, setRaceDate] = useState("");
  const [weeksOverride, setWeeksOverride] = useState("");

  // Step 2: Current fitness
  const [currentMileage, setCurrentMileage] = useState(20);
  const [peakMileage, setPeakMileage] = useState(25);
  const [marathonPR, setMarathonPR] = useState("");
  const [halfPR, setHalfPR] = useState("");
  const [longestRun, setLongestRun] = useState(8);
  const [peakMileageOverride, setPeakMileageOverride] = useState("");

  // Step 3: Schedule
  const [trainingDays, setTrainingDays] = useState(5);
  const [restDay, setRestDay] = useState("Monday");
  const [longRunDays, setLongRunDays] = useState<string[]>(["Sunday"]);
  const [runsPerWeek, setRunsPerWeek] = useState("");

  // Step 4: Preferences
  const [comfortLevel, setComfortLevel] = useState<"beginner" | "intermediate" | "advanced">("intermediate");
  const [strength, setStrength] = useState<"none" | "light" | "regular">("light");
  const [injuryHistory, setInjuryHistory] = useState("");
  const [hasPower, setHasPower] = useState(false);

  const goalMinutes = goalTime.hours * 60 + goalTime.minutes;

  const toggleLongRunDay = (day: string) => {
    if (longRunDays.includes(day)) {
      setLongRunDays(longRunDays.filter((d) => d !== day));
    } else {
      setLongRunDays([...longRunDays, day]);
    }
  };

  const handleSubmit = (skipValidation: boolean = false) => {
    const profile: RunnerProfile = {
      currentWeeklyMileage: currentMileage,
      peakHistoricalWeeklyMileage: peakMileage,
      currentMarathonPR: marathonPR ? parseInt(marathonPR, 10) : null,
      currentHalfMarathonPR: halfPR ? parseInt(halfPR, 10) : null,
      goalMarathonTime: goalMinutes,
      raceDate,
      trainingDaysPerWeek: trainingDays,
      preferredRestDay: restDay,
      recentInjuryHistory: injuryHistory || "None",
      averageEasyPace: null,
      averageMarathonPace: null,
      averageThresholdPace: null,
      hasAppleWatchPower: hasPower,
      appleWatchPowerData: hasPower ? { easyPower: null, marathonPower: null, thresholdPower: null } : undefined,
      longestRecentLongRun: longestRun,
      comfortLevelWithWorkouts: comfortLevel,
      availableLongRunDays: longRunDays,
      strengthTrainingAvailability: strength,
      peakMileageOverride: peakMileageOverride ? parseInt(peakMileageOverride, 10) : null,
      weeksOverride: weeksOverride ? parseInt(weeksOverride, 10) : null,
      runsPerWeekOverride: runsPerWeek ? parseInt(runsPerWeek, 10) : null,
    };

    if (!skipValidation) {
      const profileWarnings = validateProfile(profile);
      if (profileWarnings.length > 0) {
        setWarnings(profileWarnings);
        return;
      }
    }

    onSubmit(profile);
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress bar */}
      <div className="mb-8">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-2 flex-1 rounded-full transition-colors ${
                s <= step ? "bg-enduro-500" : "bg-gray-200"
              }`}
            />
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">Step {step} of 4</p>
      </div>

      {/* Step 1: Goal */}
      {step === 1 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">What&apos;s your marathon goal?</h2>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Goal Time</label>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-gray-500">Hours</label>
                <input
                  type="number"
                  min={2}
                  max={7}
                  value={goalTime.hours}
                  onChange={(e) => setGoalTime({ ...goalTime, hours: parseInt(e.target.value) || 2 })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-lg focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500">Minutes</label>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={goalTime.minutes}
                  onChange={(e) => setGoalTime({ ...goalTime, minutes: parseInt(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 text-lg focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Race Date</label>
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Training Weeks (optional)
            </label>
            <input
              type="number"
              min={14}
              max={28}
              placeholder="Auto-calculated from race date"
              value={weeksOverride}
              onChange={(e) => setWeeksOverride(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank to auto-calculate. Range: 14–28 weeks.
            </p>
          </div>
        </div>
      )}

      {/* Step 2: Current Fitness */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Current fitness level</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Current Weekly Mileage</label>
              <input
                type="number"
                min={5}
                max={100}
                value={currentMileage}
                onChange={(e) => setCurrentMileage(parseInt(e.target.value) || 5)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Peak Weekly Mileage</label>
              <input
                type="number"
                min={5}
                max={120}
                value={peakMileage}
                onChange={(e) => setPeakMileage(parseInt(e.target.value) || 5)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Marathon PR (minutes)</label>
              <input
                type="number"
                placeholder="e.g. 270"
                value={marathonPR}
                onChange={(e) => setMarathonPR(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Half Marathon PR (minutes)</label>
              <input
                type="number"
                placeholder="e.g. 120"
                value={halfPR}
                onChange={(e) => setHalfPR(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Longest Recent Run (miles)</label>
            <input
              type="number"
              min={1}
              max={26}
              value={longestRun}
              onChange={(e) => setLongestRun(parseInt(e.target.value) || 1)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Peak Weekly Mileage Override (optional)
            </label>
            <input
              type="number"
              min={10}
              max={120}
              placeholder="Auto-recommended based on goal time"
              value={peakMileageOverride}
              onChange={(e) => setPeakMileageOverride(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
            <p className="mt-1 text-xs text-gray-500">
              Leave blank for auto-recommendation. Range: 10–120 mi/week.
            </p>
          </div>
        </div>
      )}

      {/* Step 3: Schedule */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Training schedule</h2>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Training Days per Week: <span className="font-bold text-enduro-600">{trainingDays}</span>
            </label>
            <input
              type="range"
              min={3}
              max={7}
              value={trainingDays}
              onChange={(e) => setTrainingDays(parseInt(e.target.value))}
              className="w-full accent-enduro-500"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Runs per Week (optional)
            </label>
            <input
              type="number"
              min={3}
              max={10}
              placeholder={`Defaults to ${trainingDays} (one per training day)`}
              value={runsPerWeek}
              onChange={(e) => setRunsPerWeek(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
            <p className="mt-1 text-xs text-gray-500">
              Range: 3–10. Setting higher than training days creates AM/PM double-days.
            </p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Primary Rest Day</label>
            <select
              value={restDay}
              onChange={(e) => setRestDay(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>{day}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Long Run Day(s)</label>
            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleLongRunDay(day)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    longRunDays.includes(day)
                      ? "bg-enduro-500 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Preferences */}
      {step === 4 && (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Preferences</h2>

          {/* Validation warnings */}
          {warnings.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-amber-800">⚠️ Profile Warnings</h3>
              <ul className="list-inside list-disc space-y-1">
                {warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-700">{w}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-amber-600">
                You can fix these in previous steps or proceed anyway.
              </p>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Workout Experience</label>
            <div className="grid grid-cols-3 gap-2">
              {(["beginner", "intermediate", "advanced"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setComfortLevel(level)}
                  className={`rounded-lg border-2 px-4 py-3 text-sm font-medium capitalize transition-colors ${
                    comfortLevel === level
                      ? "border-enduro-500 bg-enduro-50 text-enduro-700"
                      : "border-gray-200 text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Strength Training</label>
            <div className="grid grid-cols-3 gap-2">
              {(["none", "light", "regular"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setStrength(level)}
                  className={`rounded-lg border-2 px-4 py-3 text-sm font-medium capitalize transition-colors ${
                    strength === level
                      ? "border-enduro-500 bg-enduro-50 text-enduro-700"
                      : "border-gray-200 text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">Recent Injury History</label>
            <textarea
              value={injuryHistory}
              onChange={(e) => setInjuryHistory(e.target.value)}
              placeholder="Any injuries in the last 6 months? (or 'None')"
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="hasPower"
              checked={hasPower}
              onChange={(e) => setHasPower(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-enduro-500 focus:ring-enduro-500"
            />
            <label htmlFor="hasPower" className="text-sm text-gray-700">
              I have Apple Watch running power data
            </label>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex justify-between">
        <button
          type="button"
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
          className="rounded-lg px-6 py-2 text-sm font-medium text-gray-600 disabled:opacity-30 hover:bg-gray-100"
        >
          Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            className="rounded-lg bg-enduro-600 px-6 py-2 text-sm font-medium text-white hover:bg-enduro-700"
          >
            Next
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={isLoading || !raceDate}
              className="rounded-lg bg-enduro-600 px-6 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
            >
              {isLoading ? "Generating..." : "Generate Plan"}
            </button>
            {warnings.length > 0 && (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={isLoading || !raceDate}
                className="rounded-lg border border-amber-300 bg-amber-50 px-6 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
              >
                Proceed Anyway
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
