// ============================================================
// EnduroLab - Race Predictor
// ============================================================

"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { RacePredictorResponse, RacePredictorResult } from "@/lib/analytics/race-predictor";

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(`${value.slice(0, 10)}T12:00:00`));
}

function PredictorLoading(): React.ReactNode {
  return (
    <div className="section-padding">
      <div className="container-narrow animate-pulse space-y-6">
        <div className="h-56 rounded-[2rem] bg-slate-200" />
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-slate-100" />)}
        </div>
      </div>
    </div>
  );
}

export default function RacePredictorPage(): React.ReactNode {
  const router = useRouter();
  const [data, setData] = useState<RacePredictorResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState("marathon");
  const [customDistance, setCustomDistance] = useState("8");
  const [customUnit, setCustomUnit] = useState<"mi" | "km">("mi");
  const [customPrediction, setCustomPrediction] = useState<RacePredictorResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [customLoading, setCustomLoading] = useState(false);
  const [targetDate, setTargetDate] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issuedMessage, setIssuedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const response = await fetch("/api/race-predictor");
      if (response.status === 401) {
        router.replace("/login?redirect=/race-predictor");
        return;
      }
      const body = (await response.json()) as RacePredictorResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to load race predictions");
      if (!cancelled) setData(body);
    };
    load()
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [router]);

  const selected = selectedKey === "custom"
    ? customPrediction
    : data?.predictions.find((prediction) => prediction.key === selectedKey) ?? data?.predictions[0] ?? null;

  async function predictCustom(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const entered = Number(customDistance);
    if (!Number.isFinite(entered) || entered <= 0) {
      setError("Enter a valid positive distance.");
      return;
    }
    const distanceMiles = customUnit === "km" ? entered / 1.609344 : entered;
    setCustomLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/race-predictor?distanceMiles=${encodeURIComponent(distanceMiles)}`);
      const body = (await response.json()) as RacePredictorResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to predict custom distance");
      const prediction = body.predictions[0] ?? null;
      setCustomPrediction(prediction ? {
        ...prediction,
        label: `${entered} ${customUnit === "km" ? "Kilometer" : "Mile"} Custom`,
      } : null);
      setSelectedKey("custom");
    } catch (predictError) {
      setError(predictError instanceof Error ? predictError.message : "Failed to predict custom distance");
    } finally {
      setCustomLoading(false);
    }
  }

  async function issueForecast(): Promise<void> {
    if (!selected || !targetDate) {
      setError("Choose a target race date before issuing the forecast.");
      return;
    }
    setIssuing(true);
    setError(null);
    setIssuedMessage(null);
    try {
      const response = await fetch("/api/race-predictor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: selected.key,
          label: selected.label,
          targetRaceName: selected.label,
          targetDate,
          targetDistanceMeters: selected.distanceMeters,
        }),
      });
      const body = (await response.json()) as { snapshotId?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to issue forecast");
      setIssuedMessage(`Forecast issued for ${formatDate(targetDate)}.`);
    } catch (issueError) {
      setError(issueError instanceof Error ? issueError.message : "Failed to issue forecast");
    } finally {
      setIssuing(false);
    }
  }

  if (loading) return <PredictorLoading />;

  if (error && !data) {
    return (
      <div className="section-padding"><div className="container-narrow">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          <h1 className="text-xl font-black">Race Predictor unavailable</h1>
          <p className="mt-2 text-sm">{error}</p>
        </div>
      </div></div>
    );
  }

  if (!data || data.predictions.length === 0 || !selected) {
    return (
      <div className="section-padding"><div className="container-narrow">
        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-20 text-center">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-enduro-700">Race Predictor</p>
          <h1 className="mt-3 text-3xl font-black text-slate-950">Race history required</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">Sync and tag at least one Garmin activity as a race to generate an evidence-based forecast.</p>
        </div>
      </div></div>
    );
  }

  const range = selected.range;
  const validation = data.validation.forecast;

  return (
    <div className="section-padding bg-[var(--color-bg-secondary)]">
      <div className="container-narrow space-y-7">
        <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-8 text-white shadow-2xl sm:px-10 sm:py-11">
          <div className="absolute -right-20 -top-24 h-72 w-72 rounded-full border-[42px] border-lime-300/10" />
          <div className="absolute bottom-0 right-1/3 h-32 w-px rotate-12 bg-gradient-to-t from-lime-300/40 to-transparent" />
          <div className="relative grid gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-end">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.28em] text-lime-300">Race Predictor · {data.modelVersion}</p>
              <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.04em] sm:text-6xl">Turn every finish into a sharper starting line.</h1>
              <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">A distance-aware forecast built from {data.raceCount} prior results, weighted for relevance and recency. {data.sourceCoverage.canonicalResults > 0 ? `${data.sourceCoverage.canonicalResults} use official result data; ${data.sourceCoverage.garminFallbacks} use Garmin fallbacks.` : "All currently use Garmin-tagged activity data."}</p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Selected forecast</span>
                <span className="rounded-full bg-lime-300/15 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-lime-200">{selected.confidence}</span>
              </div>
              <p className="mt-4 text-sm font-bold text-slate-300">{selected.label}</p>
              <p className="mt-1 font-mono text-5xl font-black tracking-tight text-white sm:text-6xl">{formatDuration(selected.predictedSeconds)}</p>
              <p className="mt-3 font-mono text-sm text-lime-200">{formatDuration(selected.paceSecondsPerMile)}/mi</p>
            </div>
          </div>
        </section>

        <section aria-label="Race distances" className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {data.predictions.map((prediction) => (
            <button key={prediction.key} type="button" onClick={() => setSelectedKey(prediction.key)} className={`rounded-2xl border p-4 text-left transition ${selectedKey === prediction.key ? "border-enduro-500 bg-enduro-950 text-white shadow-lg" : "border-[var(--color-border)] bg-[var(--color-bg)] hover:-translate-y-0.5 hover:border-enduro-400"}`}>
              <p className={`text-[10px] font-black uppercase tracking-[0.18em] ${selectedKey === prediction.key ? "text-enduro-200" : "text-enduro-700"}`}>{prediction.label}</p>
              <p className="mt-3 font-mono text-xl font-black">{formatDuration(prediction.predictedSeconds)}</p>
              <p className={`mt-1 text-xs ${selectedKey === prediction.key ? "text-slate-300" : "text-[var(--color-text-secondary)]"}`}>{formatDuration(prediction.paceSecondsPerMile)}/mi</p>
            </button>
          ))}
        </section>

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <main className="space-y-7">
            <section className="overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-sm">
              <div className="border-b border-[var(--color-border)] px-6 py-5">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-enduro-700">90% historical range</p>
                <h2 className="mt-2 text-2xl font-black">The useful answer is a band, not a bullseye.</h2>
              </div>
              <div className="p-6 sm:p-8">
                {range ? (
                  <>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4">
                      <RangeValue label="Faster edge" value={formatDuration(range.lowerSeconds)} align="left" />
                      <div className="pb-1 text-center"><div className="h-3 w-3 rounded-full bg-enduro-500 ring-8 ring-enduro-500/15" /><p className="mt-4 text-[10px] font-black uppercase tracking-wider text-enduro-700">Forecast</p></div>
                      <RangeValue label="Slower edge" value={formatDuration(range.upperSeconds)} align="right" />
                    </div>
                    <div className="relative mt-5 h-3 overflow-hidden rounded-full bg-slate-200">
                      <div className="absolute inset-y-0 left-[8%] right-[8%] rounded-full bg-gradient-to-r from-lime-400 via-enduro-500 to-amber-400" />
                      <div className="absolute inset-y-[-4px] left-1/2 w-0.5 bg-slate-950" />
                    </div>
                    <p className="mt-5 text-xs leading-5 text-[var(--color-text-secondary)]">Based on {range.errorObservations} earlier rolling forecasts. This is a 90% historical-error range, not a calibrated statistical confidence interval.</p>
                  </>
                ) : <p className="text-sm text-[var(--color-text-secondary)]">At least five prior rolling forecast errors are required to estimate a range.</p>}
              </div>
            </section>

            <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-sm sm:p-8">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div><p className="text-xs font-black uppercase tracking-[0.2em] text-enduro-700">Evidence ledger</p><h2 className="mt-2 text-2xl font-black">Why the model landed here</h2></div>
                <p className="text-xs text-[var(--color-text-secondary)]">Top {selected.strongestEvidence.length} of {selected.evidenceCount} races</p>
              </div>
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[580px] text-left text-sm">
                  <thead className="border-b border-[var(--color-border)] text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-text-secondary)]"><tr><th className="pb-3">Race</th><th className="pb-3">Result</th><th className="pb-3">Equivalent</th><th className="pb-3 text-right">Weight</th></tr></thead>
                  <tbody>{selected.strongestEvidence.map((evidence) => <tr key={evidence.raceId} className="border-b border-[var(--color-border)] last:border-0"><td className="py-4"><p className="font-bold">{evidence.distanceLabel}</p><p className="mt-1 text-xs text-[var(--color-text-secondary)]">{formatDate(evidence.raceDate)} · {evidence.ageDays} days ago</p></td><td className="py-4 font-mono">{formatDuration(evidence.actualSeconds)}</td><td className="py-4 font-mono font-bold text-enduro-700">{formatDuration(evidence.equivalentSeconds)}</td><td className="py-4 text-right font-mono text-xs">{evidence.combinedWeight.toFixed(3)}</td></tr>)}</tbody>
                </table>
              </div>
            </section>
          </main>

          <aside className="space-y-7">
            <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-enduro-700">Custom distance</p>
              <h2 className="mt-2 text-xl font-black">Build another finish line</h2>
              <form onSubmit={predictCustom} className="mt-5 space-y-4">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input type="number" min="1" step="0.01" value={customDistance} onChange={(event) => setCustomDistance(event.target.value)} aria-label="Custom race distance" className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 font-mono font-bold outline-none focus:border-enduro-500 focus:ring-2 focus:ring-enduro-500/15" />
                  <div className="flex rounded-xl bg-slate-100 p-1">
                    {(["mi", "km"] as const).map((unit) => <button key={unit} type="button" onClick={() => setCustomUnit(unit)} className={`rounded-lg px-3 text-xs font-black uppercase ${customUnit === unit ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{unit}</button>)}
                  </div>
                </div>
                <button type="submit" disabled={customLoading} className="w-full rounded-xl bg-enduro-700 px-4 py-3 text-sm font-black text-white transition hover:bg-enduro-800 disabled:opacity-50">{customLoading ? "Calculating…" : "Predict custom race"}</button>
              </form>
              {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            </section>

            <section className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6 shadow-sm">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-enduro-700">Prediction record</p>
              <h2 className="mt-2 text-xl font-black">Issue an auditable forecast</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--color-text-secondary)]">Freezes the selected prediction and every source available now for honest later evaluation.</p>
              <label className="mt-5 block text-xs font-bold text-[var(--color-text-secondary)]" htmlFor="target-race-date">Target race date</label>
              <input id="target-race-date" type="date" min={data.asOf} value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="mt-2 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3 font-mono font-bold outline-none focus:border-enduro-500 focus:ring-2 focus:ring-enduro-500/15" />
              <button type="button" onClick={issueForecast} disabled={issuing || !targetDate} className="mt-3 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50">{issuing ? "Issuing..." : `Issue ${selected.label} forecast`}</button>
              {issuedMessage && <p className="mt-3 text-xs font-bold text-enduro-700">{issuedMessage}</p>}
            </section>

            <section className="rounded-3xl bg-enduro-950 p-6 text-white shadow-lg">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-enduro-200">Model track record</p>
              <div className="mt-5 grid grid-cols-2 gap-5">
                <Metric label="Mean error" value={validation ? formatDuration(validation.meanAbsoluteErrorSeconds) : "--"} />
                <Metric label="Error rate" value={validation ? `${validation.meanAbsoluteErrorPercent.toFixed(2)}%` : "--"} />
                <Metric label="Backtests" value={String(validation?.comparisons ?? 0)} />
                <Metric label="Median error" value={validation ? `${validation.medianAbsoluteErrorPercent.toFixed(2)}%` : "--"} />
              </div>
              <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-slate-300">{data.disclaimer}</p>
            </section>

            {selected.meanMedianDisagreementPercent > 3 && <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-900">Race evidence is unusually divided: weighted mean and median differ by {selected.meanMedianDisagreementPercent.toFixed(1)}%. Treat this forecast cautiously.</div>}
          </aside>
        </div>
      </div>
    </div>
  );
}

function RangeValue({ label, value, align }: { label: string; value: string; align: "left" | "right" }): React.ReactNode {
  return <div className={align === "right" ? "text-right" : "text-left"}><p className="text-[10px] font-black uppercase tracking-[0.16em] text-[var(--color-text-secondary)]">{label}</p><p className="mt-2 font-mono text-xl font-black sm:text-3xl">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }): React.ReactNode {
  return <div><p className="text-[10px] font-black uppercase tracking-wider text-enduro-200">{label}</p><p className="mt-1 font-mono text-xl font-black">{value}</p></div>;
}
