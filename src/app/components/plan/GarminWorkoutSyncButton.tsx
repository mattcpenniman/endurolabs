"use client";

/** Explicit single-run publishing; uses only the server's saved prescription. */
import { useState, type ReactNode } from "react";
import type { Workout } from "@/lib/training/models";

export function GarminWorkoutSyncButton({ planId, date, workout, disabled = false }: {
  planId: string; date: string; workout: Workout; disabled?: boolean;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<"pace" | "power">("pace");
  const [result, setResult] = useState<{ signature: string; url?: string; error?: string } | null>(null);
  const signature = JSON.stringify({ workout, date, target });
  if (["rest", "strength", "cross_training"].includes(workout.type)) return null;
  const sync = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/plan/${planId}/garmin-workout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id, date: date.slice(0, 10), expectedWorkout: workout, target }),
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Workout sync failed");
      setResult({ signature, url: data.url });
    } catch (error) {
      setResult({ signature, error: error instanceof Error ? error.message : "Workout sync failed" });
    } finally { setBusy(false); }
  };
  const current = result?.signature === signature ? result : null;
  return (
    <div className="mt-3 space-y-1 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label={`Garmin target for ${workout.title}`} value={target} disabled={busy || disabled}
          onChange={(event) => setTarget(event.target.value as "pace" | "power")}
          className="rounded border border-gray-200 bg-white px-2 py-1 text-xs">
          <option value="pace">Pace targets</option><option value="power">Power targets</option>
        </select>
        <button type="button" disabled={busy || disabled} onClick={sync}
          className="rounded border border-enduro-200 px-3 py-1.5 text-xs font-medium text-enduro-700 disabled:opacity-50">
          {busy ? "Syncing…" : "Sync to Garmin"}
        </button>
        {current?.url && <a href={current.url} target="_blank" rel="noreferrer" className="text-xs text-enduro-700 underline">View synced workout ↗</a>}
      </div>
      <p className="text-[11px] text-gray-500">Syncs this saved run and updates previous exports. Sync your watch in Garmin Connect afterward.</p>
      <div role="status" aria-live="polite" className={`text-xs ${current?.error ? "text-red-600" : "text-enduro-700"}`}>
        {current?.error ?? (current?.url ? "Workout and date verified in Garmin Connect." : "")}
      </div>
    </div>
  );
}
