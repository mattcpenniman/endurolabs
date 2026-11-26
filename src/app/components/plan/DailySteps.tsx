"use client";
/** Private weekly daily-step loading. Missing totals stay absent; running data stays untouched. */
import { useEffect, useState } from "react";
import { isCalendarDate, summarizeWeeklySteps, type DailySteps } from "@/lib/garmin/daily-steps";

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

const STEPS_REFRESH_INTERVAL_MS = 60 * 60_000;

/** Refresh hourly or at the next browser-local midnight, whichever comes first. */
function nextRefreshTime(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.min(now.getTime() + STEPS_REFRESH_INTERVAL_MS, midnight.getTime());
}

export function useDailySteps(dates: string[], enabled: boolean): {
  totals: Record<string, number>; loading: boolean; error: string | null; refresh: () => void;
} {
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const dateKey = dates.map((date) => date.slice(0, 10)).filter(isCalendarDate).sort().join(",");
  useEffect(() => {
    if (!enabled || !dateKey) return;
    let active = true;
    let inFlight = false;
    let nextRefreshAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    function accept(days: DailySteps[]): void {
      if (active) setTotals(Object.fromEntries(days.map((day) => [day.localDate, day.totalSteps])));
    }
    function schedule(): void {
      clearTimeout(timer);
      if (active && !inFlight && document.visibilityState === "visible") {
        timer = setTimeout(() => { void load(); }, Math.max(0, nextRefreshAt - Date.now()));
      }
    }
    async function load(): Promise<void> {
      if (!active || inFlight || document.visibilityState !== "visible") return;
      // Recompute at request time so midnight includes the newly started day too.
      const pastDates = dateKey.split(",").filter((date) => date <= localToday());
      const startDate = pastDates[0];
      const endDate = pastDates.at(-1);
      nextRefreshAt = nextRefreshTime();
      if (!startDate || !endDate) { schedule(); return; }
      const range = { startDate, endDate };
      inFlight = true;
      setLoading(true); setError(null);
      try {
        const query = new URLSearchParams(range);
        const stored = await fetch(`/api/integrations/garmin/steps?${query}`, { cache: "no-store", signal: controller.signal });
        if (stored.ok) accept((await stored.json()).days);
        if (!active) return;
        const result = await fetch("/api/integrations/garmin/steps", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(range), signal: controller.signal });
        const body = await result.json();
        if (!result.ok) throw new Error(body.error ?? "Steps import unavailable");
        accept(body.days);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "Steps import unavailable");
      } finally {
        inFlight = false;
        if (active) { setLoading(false); schedule(); }
      }
    }
    function visibilityChanged(): void {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      if (Date.now() >= nextRefreshAt) void load();
      else schedule();
    }
    setTotals({});
    document.addEventListener("visibilitychange", visibilityChanged);
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      controller.abort();
    };
  }, [enabled, dateKey, revision]);
  return { totals, loading, error, refresh: () => setRevision((value) => value + 1) };
}

export function DailyStepsRefreshNote(): React.JSX.Element {
  return <span>Steps refresh hourly while this week is open and visible, and after local midnight. Returning to this tab catches up when due. Sync your device to Garmin Connect first.</span>;
}

export function WeeklyStepsBadge({ dates, totals }: { dates: string[]; totals: Record<string, number> }): React.JSX.Element | null {
  const summary = summarizeWeeklySteps(dates, totals, localToday());
  if (!summary) return null;
  const label = `Garmin weekly steps: ${summary.totalSteps.toLocaleString("en-US")} steps${summary.partial ? " so far" : ""} · ${Math.round(summary.averageSteps).toLocaleString("en-US")} steps/day average · ${summary.daysWithData}/${summary.totalDays} days with data`;
  return <span aria-label={label} title={`${label}. Average uses only days with imported totals, including rest days and true zeros. Missing and future days are excluded; today's total is incomplete. Last imported Garmin data, including running and other daily activity.`}
    className="inline-flex flex-wrap items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
    <span aria-hidden="true">👣</span>{summary.totalSteps.toLocaleString("en-US")} steps{summary.partial ? " so far" : ""}
    <span>· {Math.round(summary.averageSteps).toLocaleString("en-US")} steps/day avg</span>
    <span className="font-normal">· {summary.daysWithData}/{summary.totalDays} days with data</span>
  </span>;
}

export function DailyStepsBadge({ steps, today = false }: { steps: number | undefined; today?: boolean }): React.JSX.Element | null {
  if (steps === undefined) return null;
  const label = `Garmin daily total: ${steps.toLocaleString("en-US")} steps${today ? " so far today" : ""}`;
  return <span title={`${label}. Includes steps during runs and other daily activity; last imported total.`} aria-label={label}
    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
    <span aria-hidden="true">👣</span>{steps.toLocaleString("en-US")} steps{today ? " so far" : ""}
  </span>;
}
