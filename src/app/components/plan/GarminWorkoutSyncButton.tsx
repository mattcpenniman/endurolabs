"use client";

/** Explicit single-run publishing; uses only the server's saved prescription. */
import { useEffect, useState, type ReactNode } from "react";
import type { Workout } from "@/lib/training/models";
import type { PlanSyncEntry, PlanSyncReport } from "@/lib/garmin/plan-sync-status";

const LABELS = { synced: "Synced", changed: "Changed since sync", not_synced: "Not synced", unresolved: "Needs reconciliation", unsupported: "Cannot sync" };
function snapshot(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item);
}
// Expanded weeks mount several controls together. Share their in-flight read,
// but never cache completed reports across reloads or later edits.
const reads = new Map<string, Promise<PlanSyncReport>>();
function loadStatus(endpoint: string): Promise<PlanSyncReport> {
  const active = reads.get(endpoint);
  if (active) return active;
  const request = (async (): Promise<PlanSyncReport> => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load Garmin sync status");
    return data as PlanSyncReport;
  })();
  reads.set(endpoint, request);
  void request.finally(() => { if (reads.get(endpoint) === request) reads.delete(endpoint); }).catch(() => {});
  return request;
}

export function GarminWorkoutSyncButton({ planId, date, workout, disabled = false }: {
  planId: string; date: string; workout: Workout; disabled?: boolean;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<"pace" | "power">("pace");
  const [result, setResult] = useState<{ signature: string; url?: string; error?: string } | null>(null);
  const [saved, setSaved] = useState<{ signature: string; entry?: PlanSyncEntry; error?: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const signature = snapshot({ planId, workout, date: date.slice(0, 10), target });
  const running = !["rest", "strength", "cross_training"].includes(workout.type);
  useEffect(() => {
    if (!running) return;
    let active = true;
    const read = (): void => {
      void loadStatus(`/api/plan/${planId}/garmin-workout?target=${target}`).then((report) => {
        if (active) setSaved({ signature, entry: report.entries.find((entry) => entry.workout.id === workout.id) });
      }).catch((error: unknown) => {
        if (active) setSaved({ signature, error: error instanceof Error ? error.message : "Unable to load Garmin sync status" });
      });
    };
    read();
    window.addEventListener("focus", read);
    return () => { active = false; window.removeEventListener("focus", read); };
  }, [planId, target, signature, workout.id, running, refresh]);
  if (!running) return null;
  const sync = async (): Promise<void> => {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/plan/${planId}/garmin-workout`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id, date: date.slice(0, 10), expectedWorkout: workout, target }),
      });
      const data = await response.json() as { url?: string; error?: string; verified?: boolean };
      if (!response.ok || data.verified !== true) throw new Error(data.error ?? "Workout sync verification failed");
      setResult({ signature, url: data.url });
    } catch (error) {
      setResult({ signature, error: error instanceof Error ? error.message : "Workout sync failed" });
    } finally {
      // A read started before the write may still be in flight. The post-sync
      // refresh must read the new checkpoint rather than join that old request.
      reads.delete(`/api/plan/${planId}/garmin-workout?target=${target}`);
      setBusy(false); setRefresh((value) => value + 1);
    }
  };
  const current = result?.signature === signature ? result : null;
  const status = saved?.signature === signature ? saved : null;
  const entry = status?.entry;
  const unsaved = status && !status.error && (!entry || entry.date !== date.slice(0, 10) || snapshot(entry.workout) !== snapshot(workout));
  const label = unsaved ? "Save changes before syncing" : entry ? LABELS[entry.status] : status?.error ? "Sync status unavailable" : "Loading sync status…";
  const url = current?.url ?? entry?.url;
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
          {busy ? "Syncing…" : !unsaved && entry?.status === "synced" ? "Resync to Garmin" : "Sync to Garmin"}
        </button>
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs text-enduro-700 underline">View in Garmin ↗</a>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded px-2 py-0.5 font-medium ${!unsaved && entry?.status === "synced" ? "bg-enduro-50 text-enduro-700" : "bg-gray-100 text-gray-700"}`}>{label}</span>
        {entry?.syncedAt && <span className="text-gray-500">Last verified {new Date(entry.syncedAt).toLocaleString()}</span>}
        <button type="button" disabled={busy} onClick={() => { setSaved(null); setRefresh((value) => value + 1); }} className="text-gray-500 underline">Refresh status</button>
      </div>
      <p className="text-[11px] text-gray-500">Includes a secondary cadence goal of 180–190 spm on every running step. Syncs this saved run and updates previous exports. Sync your watch in Garmin Connect afterward.</p>
      <div role="status" aria-live="polite" className={`text-xs ${current?.error ? "text-red-600" : "text-enduro-700"}`}>
        {current?.error ?? status?.error ?? entry?.error ?? (current?.url ? "Workout and date verified in Garmin Connect." : "")}
      </div>
    </div>
  );
}
