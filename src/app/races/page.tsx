// ============================================================
// EnduroLab - Race Archive
// ============================================================

"use client";

import React, { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import GarminActivityMapCard from "@/app/components/plan/GarminActivityMapCard";
import type { RaceListResponse, RunActivity } from "@/lib/activities/models";
import {
  areComparableRaces,
  classifyRaceDistance,
  compareRaces,
  findDefaultComparisonRace,
} from "@/lib/activities/race-comparison";

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00`));
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatPace(pace: number | null): string {
  if (pace === null) return "--";
  return `${formatDuration(pace * 60)}/mi`;
}

function signed(value: number, digits = 0): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export default function RacesPage(): React.ReactNode {
  return (
    <React.Suspense fallback={<RaceLoading />}>
      <RacesPageContent />
    </React.Suspense>
  );
}

function RacesPageContent(): React.ReactNode {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRaceId = searchParams.get("race");
  const requestedDetailId = searchParams.get("runmap");
  const [races, setRaces] = useState<RunActivity[]>([]);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const authResponse = await fetch("/api/auth/me");
      if (!authResponse.ok) {
        router.replace("/login?redirect=/races");
        return;
      }
      const auth = (await authResponse.json()) as { user: { id: string } | null };
      if (!auth.user) {
        router.replace("/login?redirect=/races");
        return;
      }

      const response = await fetch("/api/races");
      const body = (await response.json()) as RaceListResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to load races");
      if (!cancelled) setRaces(body.races);
    };
    load()
      .catch((loadError: Error) => { if (!cancelled) setError(loadError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [router]);

  const selectedRace = races.find((race) => race.id === (requestedRaceId ?? requestedDetailId))
    ?? races[0]
    ?? null;
  const detailRace = races.find((race) => race.id === requestedDetailId && race.sampleCount > 0) ?? null;
  const comparableRaces = selectedRace
    ? races.filter((race) => race.id !== selectedRace.id && areComparableRaces(selectedRace, race))
    : [];
  const comparisonRace = comparableRaces.find((race) => race.id === comparisonId)
    ?? (selectedRace ? findDefaultComparisonRace(selectedRace, races) : null);
  const comparison = selectedRace && comparisonRace ? compareRaces(selectedRace, comparisonRace) : null;
  const distanceCategory = selectedRace ? classifyRaceDistance(selectedRace.distanceMiles) : null;
  const progression = selectedRace
    ? races
        .filter((race) => areComparableRaces(selectedRace, race))
        .sort((a, b) => a.startTimeGmt.localeCompare(b.startTimeGmt))
    : [];
  const bestPace = progression.reduce<number | null>((best, race) => {
    if (race.averagePaceMinutesPerMile === null) return best;
    return best === null ? race.averagePaceMinutesPerMile : Math.min(best, race.averagePaceMinutesPerMile);
  }, null);
  const uniqueDistances = new Set(races.map((race) => classifyRaceDistance(race.distanceMiles).key)).size;

  useEffect(() => {
    if (!selectedRace) return;
    setComparisonId((current) => {
      if (current && races.some((race) => race.id === current && areComparableRaces(selectedRace, race))) {
        return current;
      }
      return findDefaultComparisonRace(selectedRace, races)?.id ?? null;
    });
  }, [races, selectedRace]);

  useEffect(() => {
    if (!detailRace) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") updateRoute({ runmap: null }, "replace");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });

  function updateRoute(
    updates: { race?: string | null; runmap?: string | null },
    method: "push" | "replace" = "push",
  ): void {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const url = `/races${next.size > 0 ? `?${next.toString()}` : ""}`;
    router[method](url, { scroll: false });
  }

  async function createRaceShareLink(activityId: string): Promise<string | null> {
    const response = await fetch(`/api/races/${activityId}/share`, { method: "POST" });
    const body = (await response.json()) as { shareUrl?: string; error?: string };
    if (!response.ok) throw new Error(body.error ?? "Failed to create race share link");
    return body.shareUrl ?? null;
  }

  if (loading) return <RaceLoading />;

  if (error) {
    return (
      <div className="section-padding">
        <div className="container-narrow">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
            <h1 className="text-xl font-bold">Race archive unavailable</h1>
            <p className="mt-2 text-sm">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedRace) {
    return (
      <div className="section-padding">
        <div className="container-narrow">
          <div className="rounded-3xl border border-dashed border-gray-300 bg-gray-50 px-6 py-20 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-enduro-700">Race archive</p>
            <h1 className="mt-3 text-3xl font-black text-gray-900">No Garmin races found</h1>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-gray-600">
              Activities marked as races in Garmin will appear here after a history sync.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section-padding">
      <div className="container-narrow space-y-8">
        <section className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-8 text-white shadow-xl sm:px-10 sm:py-10">
          <div className="absolute -right-16 -top-24 h-64 w-64 rounded-full border-[36px] border-enduro-500/20" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.26em] text-enduro-300">Race archive</p>
              <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-tight sm:text-5xl">
                Every finish tells a story.
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                Revisit race-day routes and splits, compare like-for-like efforts, and see where the clock moved.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-6 border-t border-white/15 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <HeroStat label="Finishes" value={String(races.length)} />
              <HeroStat label="Distances" value={String(uniqueDistances)} />
              <HeroStat label="Since" value={races.at(-1)?.localDate.slice(0, 4) ?? "--"} />
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4">
                <h2 className="font-bold text-gray-900">Finishes</h2>
                <p className="mt-1 text-xs text-gray-500">Newest first · {races.length} Garmin races</p>
              </div>
              <div className="scrollbar-thin max-h-[620px] overflow-y-auto p-2">
                {races.map((race) => {
                  const category = classifyRaceDistance(race.distanceMiles);
                  const selected = race.id === selectedRace.id;
                  return (
                    <button
                      key={race.id}
                      type="button"
                      onClick={() => updateRoute({ race: race.id, runmap: null })}
                      className={`w-full rounded-xl px-3 py-3 text-left transition ${selected ? "bg-enduro-950 text-white" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-bold ${selected ? "text-white" : "text-gray-900"}`}>{race.activityName}</p>
                          <p className={`mt-1 text-xs ${selected ? "text-slate-300" : "text-gray-500"}`}>{formatDate(race.localDate)}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${selected ? "bg-white/10 text-enduro-200" : "bg-enduro-50 text-enduro-800"}`}>
                          {category.label}
                        </span>
                      </div>
                      <div className={`mt-3 flex gap-4 font-mono text-xs ${selected ? "text-slate-200" : "text-gray-500"}`}>
                        <span>{formatDuration(race.durationSeconds)}</span>
                        <span>{formatPace(race.averagePaceMinutesPerMile)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-8">
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-5 py-5 sm:px-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-enduro-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-enduro-800">{distanceCategory?.label}</span>
                      {bestPace !== null && selectedRace.averagePaceMinutesPerMile === bestPace && (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-amber-800">Fastest pace</span>
                      )}
                    </div>
                    <h2 className="mt-3 text-2xl font-black text-gray-900 sm:text-3xl">{selectedRace.activityName}</h2>
                    <p className="mt-1 text-sm text-gray-500">{formatDate(selectedRace.localDate)} · {selectedRace.distanceMiles.toFixed(2)} recorded miles</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRoute({ race: selectedRace.id, runmap: selectedRace.id })}
                    disabled={selectedRace.sampleCount <= 0}
                    className="rounded-xl bg-enduro-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-enduro-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {selectedRace.sampleCount > 0 ? "Open race details" : "Detail unavailable"}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 divide-x divide-y divide-gray-100 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
                <RaceMetric label="Finish" value={formatDuration(selectedRace.durationSeconds)} />
                <RaceMetric label="Pace" value={formatPace(selectedRace.averagePaceMinutesPerMile)} />
                <RaceMetric label="Avg HR" value={selectedRace.averageHeartRate ? `${selectedRace.averageHeartRate} bpm` : "--"} />
                <RaceMetric label="Max HR" value={selectedRace.maxHeartRate ? `${selectedRace.maxHeartRate} bpm` : "--"} />
                <RaceMetric label="Power" value={selectedRace.averagePower ? `${selectedRace.averagePower} W` : "--"} />
                <RaceMetric label="Elevation" value={selectedRace.elevationGainMeters ? `${selectedRace.elevationGainMeters} m` : "--"} />
              </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-enduro-700">Head to head</p>
                  <h2 className="mt-2 text-xl font-black text-gray-900">Race improvement</h2>
                  <p className="mt-1 text-sm text-gray-500">Compared only with other {distanceCategory?.label.toLowerCase()} efforts.</p>
                </div>
                {comparableRaces.length > 0 && (
                  <label className="block sm:w-72">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-gray-500">Baseline race</span>
                    <select
                      value={comparisonRace?.id ?? ""}
                      onChange={(event) => setComparisonId(event.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      {comparableRaces.map((race) => (
                        <option key={race.id} value={race.id}>{race.localDate} · {race.activityName}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {comparison && comparisonRace ? (
                <>
                  <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <DeltaCard
                      label="Finish time"
                      value={formatTimeImprovement(comparison.timeImprovementSeconds)}
                      detail={`${Math.abs(comparison.timeImprovementPercent).toFixed(1)}% ${comparison.timeImprovementSeconds >= 0 ? "faster" : "slower"}`}
                      positive={comparison.timeImprovementSeconds > 0}
                    />
                    <DeltaCard
                      label="Average pace"
                      value={comparison.paceImprovementMinutesPerMile === null ? "--" : formatPaceDelta(comparison.paceImprovementMinutesPerMile)}
                      detail={`${formatPace(selectedRace.averagePaceMinutesPerMile)} vs ${formatPace(comparisonRace.averagePaceMinutesPerMile)}`}
                      positive={(comparison.paceImprovementMinutesPerMile ?? 0) > 0}
                    />
                    <DeltaCard
                      label="Heart rate"
                      value={comparison.heartRateDelta === null ? "--" : `${signed(comparison.heartRateDelta)} bpm`}
                      detail="Selected minus baseline"
                    />
                    <DeltaCard
                      label="Average power"
                      value={comparison.powerDelta === null ? "--" : `${signed(comparison.powerDelta)} W`}
                      detail="Selected minus baseline"
                    />
                  </div>
                  <p className="mt-4 text-xs text-gray-500">
                    Comparing {formatDate(selectedRace.localDate)} against {formatDate(comparisonRace.localDate)}. Finish-time changes include normal GPS distance variation.
                  </p>
                </>
              ) : (
                <div className="mt-6 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-8 text-center text-sm text-gray-600">
                  This is the only {distanceCategory?.label.toLowerCase()} race in the archive. Add another finish to unlock a comparison.
                </div>
              )}
            </section>

            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-5 py-4 sm:px-6">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-enduro-700">Progression</p>
                <h2 className="mt-2 text-xl font-black text-gray-900">{distanceCategory?.label} history</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <tr>
                      <th className="px-5 py-3">Race</th>
                      <th className="px-4 py-3">Distance</th>
                      <th className="px-4 py-3">Finish</th>
                      <th className="px-4 py-3">Pace</th>
                      <th className="px-4 py-3">Avg HR</th>
                      <th className="px-4 py-3">Power</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {progression.map((race) => (
                      <tr key={race.id} className={race.id === selectedRace.id ? "bg-enduro-50/70" : "hover:bg-gray-50"}>
                        <td className="px-5 py-3">
                          <button type="button" onClick={() => updateRoute({ race: race.id, runmap: null })} className="text-left">
                            <span className="block font-bold text-gray-900">{race.activityName}</span>
                            <span className="text-xs text-gray-500">{formatDate(race.localDate)}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-gray-600">{race.distanceMiles.toFixed(2)} mi</td>
                        <td className="px-4 py-3 font-mono font-bold text-gray-900">{formatDuration(race.durationSeconds)}</td>
                        <td className="px-4 py-3 font-mono text-gray-700">{formatPace(race.averagePaceMinutesPerMile)}</td>
                        <td className="px-4 py-3 font-mono text-gray-600">{race.averageHeartRate ?? "--"}</td>
                        <td className="px-4 py-3 font-mono text-gray-600">{race.averagePower ? `${race.averagePower} W` : "--"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </main>
        </div>
      </div>

      {detailRace && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => updateRoute({ runmap: null }, "replace")}
          role="dialog"
          aria-modal="true"
          aria-label="Race details"
        >
          <div className="my-4 max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 bg-slate-950 px-5 py-3 text-white">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-enduro-300">Race details</p>
                <p className="mt-0.5 text-sm font-bold">{detailRace.activityName} · {formatDate(detailRace.localDate)}</p>
              </div>
              <button type="button" onClick={() => updateRoute({ runmap: null }, "replace")} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-white/10 hover:text-white">
                Close
              </button>
            </div>
            <div className="max-h-[calc(92vh-68px)] overflow-y-auto bg-gray-50 p-2 sm:p-4">
              <GarminActivityMapCard
                activities={races}
                activityId={detailRace.id}
                onActivityChange={(activityId) => updateRoute({ race: activityId, runmap: activityId }, "replace")}
                onCreateShareLink={() => createRaceShareLink(detailRace.id)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RaceLoading(): React.ReactNode {
  return (
    <div className="section-padding">
      <div className="container-narrow flex items-center justify-center py-32">
        <div className="text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-enduro-200 border-t-enduro-700" />
          <p className="mt-4 text-sm font-semibold text-gray-600">Loading race archive...</p>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value }: { label: string; value: string }): React.ReactNode {
  return <div><p className="font-mono text-2xl font-black">{value}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p></div>;
}

function RaceMetric({ label, value }: { label: string; value: string }): React.ReactNode {
  return <div className="min-w-0 px-4 py-4"><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p><p className="mt-1 truncate font-mono text-base font-bold text-gray-900">{value}</p></div>;
}

function DeltaCard({ label, value, detail, positive }: { label: string; value: string; detail: string; positive?: boolean }): React.ReactNode {
  return (
    <div className={`rounded-xl border p-4 ${positive ? "border-enduro-200 bg-enduro-50" : "border-gray-200 bg-gray-50"}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`mt-2 font-mono text-xl font-black ${positive ? "text-enduro-800" : "text-gray-900"}`}>{value}</p>
      <p className="mt-1 text-[11px] text-gray-500">{detail}</p>
    </div>
  );
}

function formatTimeImprovement(seconds: number): string {
  if (seconds === 0) return "Even";
  return `${seconds > 0 ? "-" : "+"}${formatDuration(Math.abs(seconds))}`;
}

function formatPaceDelta(minutesPerMile: number): string {
  if (minutesPerMile === 0) return "Even";
  return `${minutesPerMile > 0 ? "-" : "+"}${formatDuration(Math.abs(minutesPerMile) * 60)}/mi`;
}
