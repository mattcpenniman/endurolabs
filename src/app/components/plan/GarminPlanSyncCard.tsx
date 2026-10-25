"use client";

/** Resumable, sequential full-plan export using the durable single-workout API. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MarathonPlan } from "@/lib/training/models";
import type { PlanSyncReport } from "@/lib/garmin/plan-sync-status";

const LABELS = { synced: "Synced", changed: "Changed since sync", not_synced: "Not synced", unresolved: "Needs reconciliation", unsupported: "Cannot sync" };

export function GarminPlanSyncCard({ plan, disabled = false }: { plan: MarathonPlan; disabled?: boolean }): ReactNode {
  const [target, setTarget] = useState<"pace" | "power">("pace");
  const [report, setReport] = useState<PlanSyncReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const stop = useRef(false);
  const endpoint = `/api/plan/${plan.id}/garmin-workout`;
  const planVersion = JSON.stringify(plan.weeks);
  const load = useCallback(async (): Promise<PlanSyncReport> => {
    const response = await fetch(`${endpoint}?target=${target}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Unable to load Garmin sync status");
    return data as PlanSyncReport;
  }, [endpoint, target]);

  useEffect(() => {
    const current = ++generation.current;
    setReport(null); setLoading(true); setError(""); setMessage("");
    const refresh = (): void => {
      void load().then((data) => {
        if (generation.current === current) { setReport(data); setError(""); }
      }).catch((failure: unknown) => {
        if (generation.current === current) setError(failure instanceof Error ? failure.message : "Unable to load sync status");
      }).finally(() => { if (generation.current === current) setLoading(false); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { generation.current++; window.removeEventListener("focus", refresh); };
  }, [load, planVersion]);

  const sync = async (): Promise<void> => {
    const current = generation.current;
    const active = (): boolean => generation.current === current;
    stop.current = false;
    setBusy(true); setError(""); setMessage("Checking saved plan…");
    let completed = 0;
    try {
      const latest = await load();
      if (!active()) return;
      setReport(latest);
      const unsupported = latest.entries.find((entry) => entry.status === "unsupported");
      if (unsupported) throw new Error(`${unsupported.date} ${unsupported.workout.title}: ${unsupported.error}`);
      // Resume partial exports without re-sending already confirmed unchanged runs.
      const outstanding = latest.entries.filter((entry) => entry.status !== "synced");
      const queue = outstanding.length ? outstanding : latest.entries;
      for (const entry of queue) {
        if (!active() || stop.current) break;
        setMessage(`Syncing ${completed + 1} of ${queue.length}: ${entry.date} ${entry.workout.title}`);
        const response = await fetch(endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workoutId: entry.workout.id, date: entry.date, expectedWorkout: entry.workout, target }),
        });
        const data = await response.json();
        if (!response.ok || data.verified !== true) throw new Error(`${entry.date} ${entry.workout.title}: ${data.error ?? "Garmin verification failed"}`);
        completed++;
      }
      if (active()) setMessage(stop.current ? `Stopped after ${completed} workouts. Resume to continue.` : `${completed} workouts verified in Garmin Connect.`);
    } catch (failure) {
      if (active()) {
        setMessage(`${completed} workouts completed. Progress is saved; retry to resume.`);
        setError(failure instanceof Error ? failure.message : "Plan sync failed");
      }
    } finally {
      if (active()) {
        try { const latest = await load(); if (active()) setReport(latest); }
        catch { if (active()) setError((previous) => previous || "Unable to refresh sync status. Reload to check saved progress."); }
      }
      setBusy(false);
    }
  };
  const entries = report?.entries ?? [];
  const synced = entries.filter((entry) => entry.status === "synced").length;
  const changed = entries.filter((entry) => entry.status === "changed").length;
  const unresolved = entries.filter((entry) => entry.status === "unresolved").length;
  return <section className="rounded-lg border border-gray-200 bg-white p-5 md:col-span-2" aria-label="Garmin plan sync">
    <h3 className="text-sm font-semibold text-gray-900">Sync full plan to Garmin</h3>
    <p className="mt-1 text-sm text-gray-500">Exports all saved running workouts with their scheduled dates. On double days, the main run is sent first and labeled AM / first; the secondary run follows as PM / second. Updates previous exports in place. Keep this tab open during sync, then sync your watch in Garmin Connect.</p>
    <p className="mt-1 text-sm text-gray-500">Every running step includes a secondary cadence goal of 180–190 spm alongside the selected pace or power target.</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <select aria-label="Full plan Garmin target" value={target} disabled={busy || disabled} onChange={(event) => setTarget(event.target.value as "pace" | "power")}
        className="rounded border border-gray-300 px-3 py-2 text-sm">
        <option value="pace">Pace targets</option><option value="power">Power targets</option>
      </select>
      <button type="button" onClick={sync} disabled={busy || loading || disabled || !report || !entries.length}
        className="rounded-lg bg-sky-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Syncing plan…" : synced === entries.length && entries.length ? "Resync full plan" : synced || changed || unresolved ? "Resync changed / remaining workouts" : "Sync full plan to Garmin"}
      </button>
      {busy && <button type="button" onClick={() => { stop.current = true; }} className="text-sm underline">Stop after current workout</button>}
      {!busy && <button type="button" onClick={async () => {
        setLoading(true);
        try { setReport(await load()); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to refresh status"); }
        finally { setLoading(false); }
      }} className="text-sm underline" disabled={loading}>Refresh status</button>}
    </div>
    <div role="status" aria-live="polite" className="mt-3 text-sm text-gray-700">
      {loading ? "Loading sync status…" : report ? `${synced} of ${entries.length} workouts synced to the saved plan. ${changed} changed since sync. ${unresolved} unresolved.` : "Sync status unavailable."}
      {message && <p className="mt-1">{message}</p>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {Boolean(report?.removedExports) && <p className="mt-2 text-sm text-amber-800">{report!.removedExports} previous exports are no longer in this plan. Their Garmin calendar entries remain; remove those entries in Garmin Connect.</p>}
    {entries.length > 0 && <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">Workout sync status and last verified times</summary>
      <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {entries.map((entry, index) => <li key={`${entry.workout.id}-${index}`} className="border-t border-gray-100 pt-2">
          <span className="font-medium">{entry.date} · {entry.workout.title}</span> — {LABELS[entry.status]}
          {entry.syncedAt && <span> · Last verified {new Date(entry.syncedAt).toLocaleString()}</span>}
          {entry.url && <a className="ml-2 text-enduro-700 underline" href={entry.url} target="_blank" rel="noreferrer">View in Garmin</a>}
          {entry.error && <p className="text-red-700">{entry.error}</p>}
        </li>)}
      </ul>
    </details>}
    <p className="mt-2 text-xs text-gray-500">Status compares the saved plan with the last verified Garmin export; it does not poll for edits made in Garmin. Plan edits require an explicit resync. Rest and non-running sessions are skipped.</p>
  </section>;
}
