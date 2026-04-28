"use client";

// ============================================================
// EnduroLab — Weekly Progress Tracker
// ============================================================
// Allows logging actual mileage, feel ratings, and adherence
// per week. Shows trends and adjustment suggestions.
// ============================================================

import { useState } from "react";
import { WeeklyPlan, MarathonPlan } from "@/lib/training/models";
import { addLog, analyzeProgress, loadLogs } from "@/lib/training/progress-tracker";

interface WeeklyProgressTrackerProps {
  plan: MarathonPlan;
}

export default function WeeklyProgressTracker({ plan }: WeeklyProgressTrackerProps) {
  const [editingWeek, setEditingWeek] = useState<number | null>(null);
  const [actualMileage, setActualMileage] = useState(0);
  const [longRunActual, setLongRunActual] = useState(0);
  const [feelRating, setFeelRating] = useState(5);
  const [adherence, setAdherence] = useState(100);
  const [notes, setNotes] = useState("");
  const [refresh, setRefresh] = useState(0); // bump to reload logs

  // Load logs fresh each render cycle
  const logs = loadLogs(plan.id);
  const progress = analyzeProgress(plan, logs);
  const currentWeekNum = plan.weeks[plan.weeks.length - 1]?.weekNumber ?? plan.totalWeeks;

  const handleSave = (weekNumber: number) => {
    const log = {
      weekNumber,
      actualMileage,
      plannedMileage: plan.weeks.find((w) => w.weekNumber === weekNumber)?.totalMileage ?? 0,
      longRunActual,
      longRunPlanned: plan.weeks.find((w) => w.weekNumber === weekNumber)?.longRunDistance ?? 0,
      feelRating,
      adherence,
      notes,
      loggedAt: new Date().toISOString(),
    };
    addLog(plan.id, log);
    setEditingWeek(null);
    setRefresh((r) => r + 1); // trigger reload
  };

  const getWeekStatus = (week: WeeklyPlan) => {
    const log = logs.find((l) => l.weekNumber === week.weekNumber);
    if (log) return "logged";
    if (week.weekNumber > currentWeekNum) return "upcoming";
    return "current";
  };

  // Determine if adaptive volume reduction should be shown
  const shouldSuggestReduction = progress.adjustmentSuggestions.some(
    (s) => s.includes("reducing") || s.includes("back off") || s.includes("recovery week")
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-xl font-bold text-gray-900">📊 Weekly Progress</h3>
        <p className="mt-1 text-sm text-gray-500">
          Track your actual vs. planned mileage each week
        </p>
      </div>

      {/* Summary Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="rounded-lg bg-enduro-50 p-4 text-center">
          <p className="text-2xl font-bold text-enduro-700">{progress.averageFeel || "—"}</p>
          <p className="text-xs text-enduro-600">Avg Feel (1-10)</p>
        </div>
        <div className="rounded-lg bg-blue-50 p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{progress.averageAdherence || "—"}%</p>
          <p className="text-xs text-blue-600">Avg Adherence</p>
        </div>
        <div className="rounded-lg bg-purple-50 p-4 text-center">
          <p className="text-2xl font-bold text-purple-700">{progress.projectedPeakMileage || "—"}</p>
          <p className="text-xs text-purple-600">Projected Peak</p>
        </div>
      </div>

      {/* Weekly Log Table */}
      <div className="mb-6 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="pb-2 text-left font-medium text-gray-500">Week</th>
              <th className="pb-2 text-left font-medium text-gray-500">Planned</th>
              <th className="pb-2 text-left font-medium text-gray-500">Actual</th>
              <th className="pb-2 text-left font-medium text-gray-500">Long Run</th>
              <th className="pb-2 text-left font-medium text-gray-500">Feel</th>
              <th className="pb-2 text-left font-medium text-gray-500">Adherence</th>
              <th className="pb-2 text-left font-medium text-gray-500">Action</th>
            </tr>
          </thead>
          <tbody>
            {plan.weeks.map((week) => {
              const status = getWeekStatus(week);
              const isCurrent = week.weekNumber === currentWeekNum;
              const log = logs.find((l) => l.weekNumber === week.weekNumber);

              return (
                <tr
                  key={week.weekNumber}
                  className={`border-b border-gray-100 ${
                    isCurrent ? "bg-enduro-50" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-3 font-medium text-gray-900">
                    {week.weekNumber}
                    {isCurrent && <span className="ml-1 text-xs text-enduro-600">(current)</span>}
                  </td>
                  <td className="py-3 text-gray-700">{week.totalMileage} mi</td>
                  <td className="py-3 text-gray-700">
                    {log ? `${log.actualMileage} mi` : "—"}
                  </td>
                  <td className="py-3 text-gray-700">
                    {log ? `${log.longRunActual} / ${week.longRunDistance} mi` : `${week.longRunDistance} mi`}
                  </td>
                  <td className="py-3">
                    {log ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        log.feelRating >= 7 ? "bg-green-100 text-green-700" :
                        log.feelRating >= 4 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {log.feelRating}/10
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {log ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        log.adherence >= 80 ? "bg-green-100 text-green-700" :
                        log.adherence >= 60 ? "bg-amber-100 text-amber-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {log.adherence}%
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="py-3">
                    {status !== "logged" ? (
                      <button
                        onClick={() => {
                          setEditingWeek(week.weekNumber);
                          setActualMileage(0);
                          setLongRunActual(0);
                          setFeelRating(5);
                          setAdherence(100);
                          setNotes("");
                        }}
                        className="rounded-lg bg-enduro-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-enduro-700"
                      >
                        Log
                      </button>
                    ) : (
                      <span className="text-xs text-green-600">✓ Logged</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Log Modal */}
      {editingWeek !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Log Week {editingWeek}</h3>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Actual Mileage (mi)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={actualMileage}
                  onChange={(e) => setActualMileage(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Long Run (mi)
                </label>
                <input
                  type="number"
                  min={0}
                  max={30}
                  step={0.1}
                  value={longRunActual}
                  onChange={(e) => setLongRunActual(parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  How did the week feel? ({feelRating}/10)
                </label>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={feelRating}
                  onChange={(e) => setFeelRating(parseInt(e.target.value))}
                  className="w-full accent-enduro-500"
                />
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Terrible</span>
                  <span>Amazing</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Workout Adherence ({adherence}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={adherence}
                  onChange={(e) => setAdherence(parseInt(e.target.value))}
                  className="w-full accent-enduro-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Injuries, weather, life events..."
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-enduro-500 focus:outline-none focus:ring-2 focus:ring-enduro-500/20"
                />
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setEditingWeek(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSave(editingWeek)}
                className="flex-1 rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjustment Suggestions */}
      {progress.adjustmentSuggestions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h4 className="mb-2 text-sm font-semibold text-amber-900">💡 Suggestions</h4>
          <ul className="space-y-2">
            {progress.adjustmentSuggestions.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-800">
                <span>•</span>
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
