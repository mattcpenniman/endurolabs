/** All-run history, including unassigned and summary-only activities. */
"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import { RunScoreBadge } from "@/app/components/plan/RunScoreDetails";
import { useUnits } from "@/app/components/units/UnitsProvider";
import type { RunActivity } from "@/lib/activities/models";
import { formatPaceWithUnit, KILOMETERS_PER_MILE, paceUnitAbbr } from "@/lib/units/format";

interface RunHistoryResponse {
  activities: RunActivity[];
  selectedActivity: RunActivity | null;
  total: number;
  page: number;
  pageSize: number;
}

export default function RunsPage(): React.ReactNode {
  return <React.Suspense fallback={<p className="section-padding container-narrow">Loading runs…</p>}><RunHistory /></React.Suspense>;
}

function RunHistory(): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { units } = useUnits();
  const queryString = searchParams.toString();
  const [history, setHistory] = useState<RunHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const [refresh, setRefresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const requestedId = searchParams.get("run");
  const selected = history?.activities.find((run) => run.id === requestedId)
    ?? history?.selectedActivity ?? history?.activities[0] ?? null;

  useEffect(() => { setSearch(searchParams.get("q") ?? ""); }, [queryString]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/activities?${queryString}`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          router.replace(`/login?redirect=${encodeURIComponent(`/runs?${queryString}`)}`);
          return null;
        }
        const body = await response.json() as RunHistoryResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Failed to load runs");
        return body;
      })
      .then((body) => { if (!cancelled && body) setHistory(body); })
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [queryString, refresh, router]);

  function navigate(updates: Record<string, string | null>): void {
    const next = new URLSearchParams(queryString);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    router.push(`/runs${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  async function createShareLink(): Promise<string | null> {
    if (!selected) return null;
    const response = await fetch(`/api/activities/${selected.id}/share`, { method: "POST" });
    const body = await response.json() as { shareUrl?: string; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Failed to share run");
    return body.shareUrl ?? null;
  }

  async function toggleAnalytics(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/activities/${selected.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excludedFromAnalytics: !selected.excludedFromAnalytics }),
      });
      if (!response.ok) throw new Error("Failed to update analytics setting");
      setRefresh((value) => value + 1);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Failed to update run"); }
    finally { setSaving(false); }
  }

  const distance = (miles: number): string => `${(units === "metric" ? miles * KILOMETERS_PER_MILE : miles).toFixed(2)} ${paceUnitAbbr(units)}`;
  return (
    <main className="section-padding">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><h1 className="text-3xl font-bold">Runs</h1><p className="mt-2 text-sm text-[var(--color-text-secondary)]">Your complete run history, across all plans and runs without a plan.</p></div>
          <Link href="/profile#garmin-detail-sync" className="text-sm font-medium text-enduro-700 underline">Import & sync runs</Link>
        </div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); navigate({ q: search.trim() || null, page: null, run: null }); }}>
          <label className="flex-1 text-sm">Search runs<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Run name" className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900" /></label>
          <label className="text-sm">Plan association<select value={searchParams.get("plan") ?? "all"} onChange={(event) => navigate({ plan: event.target.value === "all" ? null : event.target.value, page: null, run: null })} className="mt-1 block rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900"><option value="all">All runs</option><option value="linked">Attached to a plan</option><option value="unassigned">No plan</option></select></label>
          <button type="submit" className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white">Search</button>
        </form>
        {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error} <button onClick={() => setRefresh((value) => value + 1)} className="underline">Retry</button></div>}
        {loading && <p role="status" className="text-sm text-[var(--color-text-secondary)]">Loading runs…</p>}
        {history && <div className="flex flex-col gap-6" aria-busy={loading}>
          <section aria-label="Run history" className="order-2 overflow-hidden rounded-xl border border-gray-200 bg-white text-gray-900 shadow-sm">
            <div className="border-b border-gray-200 px-4 py-3 text-sm font-medium">{history.total.toLocaleString()} runs</div>
            {history.activities.length === 0 ? <p className="p-6 text-sm text-gray-500">No runs found. Try another search or import runs from your Profile.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr>{["Run", "Distance", "Time", "Pace", "HR", "Power", "Score", "Plan"].map((title) => <th key={title} className="whitespace-nowrap px-4 py-3">{title}</th>)}</tr></thead>
              <tbody>{history.activities.map((run) => <tr key={run.id} className={`border-t border-gray-100 ${selected?.id === run.id ? "bg-enduro-50" : "hover:bg-gray-50"}`}>
                <td className="px-4 py-3"><button onClick={() => navigate({ run: run.id })} className="text-left font-semibold text-enduro-700 underline" aria-current={selected?.id === run.id ? "true" : undefined}>{run.activityName}</button><p className="mt-1 whitespace-nowrap text-xs text-gray-500">{run.localDate} · {run.eventType === "race" ? "Race" : "Run"}{run.sampleCount === 0 ? " · Summary only" : ""}{run.excludedFromAnalytics ? " · Excluded" : ""}</p></td>
                <td className="whitespace-nowrap px-4 py-3">{distance(run.distanceMiles)}</td><td className="px-4 py-3">{formatDuration(run.durationSeconds)}</td><td className="whitespace-nowrap px-4 py-3">{formatPaceWithUnit(run.averagePaceMinutesPerMile, units)}</td><td className="whitespace-nowrap px-4 py-3">{run.averageHeartRate ? `${Math.round(run.averageHeartRate)} bpm` : "—"}</td><td className="whitespace-nowrap px-4 py-3">{run.averagePower ? `${run.averagePowerEstimated ? "~" : ""}${Math.round(run.averagePower)} W` : "—"}</td>
                <td className="px-4 py-3"><RunScoreBadge score={run.runScore} /></td><td className="whitespace-nowrap px-4 py-3">{run.planId ? <Link href={`/plan?plan=${run.planId}`} className="text-enduro-700 underline">View plan{run.weekNumber ? ` · W${run.weekNumber}` : ""}</Link> : "No plan"}</td>
              </tr>)}</tbody>
            </table></div>}
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-sm">
              <button disabled={history.page <= 1} onClick={() => navigate({ page: String(history.page - 1), run: null })} className="font-medium text-enduro-700 disabled:opacity-40">Previous</button><span>Page {history.page} of {Math.max(1, Math.ceil(history.total / history.pageSize))}</span><button disabled={history.page * history.pageSize >= history.total} onClick={() => navigate({ page: String(history.page + 1), run: null })} className="font-medium text-enduro-700 disabled:opacity-40">Next</button>
            </div>
          </section>
          {selected && <section aria-label="Selected run details" className="order-1 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Run details</h2><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!selected.excludedFromAnalytics} disabled={saving} onChange={() => void toggleAnalytics()} />Include in analytics</label></div>
            <GarminActivityMapCard activities={[selected, ...history.activities.filter((run) => run.id !== selected.id)]} activityId={selected.id} onActivityChange={(id) => navigate({ run: id })} onCreateShareLink={createShareLink} />
          </section>}
        </div>}
      </div>
    </main>
  );
}

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const remainder = String(rounded % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}
