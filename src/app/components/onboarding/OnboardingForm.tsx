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

export default function OnboardingForm({ onSubmit, isLoading }: OnboardingFormProps) {
  const [step, setStep] = useState(1);

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

  const handleSubmit = () => {
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
    };
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
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || !raceDate}
            className="rounded-lg bg-enduro-600 px-6 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
          >
            {isLoading ? "Generating..." : "Generate Plan"}
          </button>
        )}
      </div>
    </div>
  );
}
