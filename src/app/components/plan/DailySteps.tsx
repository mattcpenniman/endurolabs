"use client";
/** Private weekly daily-step loading. Missing totals stay absent; running data stays untouched. */
import { useEffect, useState } from "react";
import { isCalendarDate, type DailySteps } from "@/lib/garmin/daily-steps";

export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function useDailySteps(dates: string[], enabled: boolean): {
  totals: Record<string, number>; loading: boolean; error: string | null; refresh: () => void;
} {
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const pastDates = dates.map((date) => date.slice(0, 10)).filter((date) => isCalendarDate(date) && date <= localToday()).sort();
  const startDate = pastDates[0];
  const endDate = pastDates.at(-1);
  useEffect(() => {
    if (!enabled || !startDate || !endDate) return;
    const range = { startDate, endDate };
    let active = true;
    const controller = new AbortController();
    function accept(days: DailySteps[]): void {
      if (active) setTotals(Object.fromEntries(days.map((day) => [day.localDate, day.totalSteps])));
    }
    async function load(): Promise<void> {
      setLoading(true); setError(null); setTotals({});
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
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); };
  }, [enabled, startDate, endDate, revision]);
  return { totals, loading, error, refresh: () => setRevision((value) => value + 1) };
}

export function DailyStepsBadge({ steps, today = false }: { steps: number | undefined; today?: boolean }): React.JSX.Element | null {
  if (steps === undefined) return null;
  const label = `Garmin daily total: ${steps.toLocaleString("en-US")} steps${today ? " so far today" : ""}`;
  return <span title={`${label}. Includes steps during runs and other daily activity; last imported total.`} aria-label={label}
    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
    <span aria-hidden="true">👣</span>{steps.toLocaleString("en-US")} steps{today ? " so far" : ""}
  </span>;
}
