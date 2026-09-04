"use client";

// ============================================================
// EnduroLab - Garmin Activity Map Card
// ============================================================
// Interactive run route rendered as an SVG map.  Route metrics
// come from the Garmin activity summary; clicking a route point
// shows the per-minute sample data (HR, power, cadence, pace,
// elevation, temperature) fetched from the sample trace API.

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityDetailResponse, ActivitySplit, RunActivity } from "@/lib/activities/models";
import GarminActivityLeafletMap from "@/app/components/plan/GarminActivityLeafletMap";
import { buildSharedRunUrl } from "@/lib/plan-url";
import { toBlob } from "html-to-image";

const METERS_PER_MILE = 1609.344;

export interface GarminActivityMapCardProps {
  activities: RunActivity[];
  activityId?: string | null;
  onActivityChange?: (activityId: string) => void;
  detailUrlPrefix?: string;
  shareBaseUrl?: string | null;
  onCreateShareLink?: () => Promise<string | null>;
}

// Module-level cache so an activity trace is fetched at most
// once per tab, across any number of card mounts.
const activityDetailCache = new Map<string, ActivityDetailResponse>();

function useActivityDetail(activityId: string | null, detailUrlPrefix: string): ActivityDetailResponse | null {
  const cacheKey = activityId ? `${detailUrlPrefix}/${activityId}` : null;
  const [detail, setDetail] = useState<ActivityDetailResponse | null>(
    cacheKey ? activityDetailCache.get(cacheKey) ?? null : null
  );

  useEffect(() => {
    if (!activityId || !cacheKey) {
      setDetail(null);
      return;
    }
    const cached = activityDetailCache.get(cacheKey);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;
    setDetail(null);
    fetch(cacheKey)
      .then(async (response) => {
        const body = (await response.json()) as ActivityDetailResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Failed to load activity detail");
        return body;
      })
      .then((body) => {
        if (cancelled) return;
        activityDetailCache.set(cacheKey, body);
        setDetail(body);
      })
      .catch(() => {
        if (cancelled) return;
        const empty = { samples: [], splits: [] };
        activityDetailCache.set(cacheKey, empty);
        setDetail(empty);
      });

    return () => { cancelled = true; };
  }, [activityId, cacheKey]);

  return detail;
}

function formatElapsed(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPace(minutesPerMile: number | null): string {
  if (minutesPerMile === null) return "--";
  const totalSeconds = Math.round(minutesPerMile * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function GarminActivityMapCard({
  activities,
  activityId,
  onActivityChange,
  detailUrlPrefix = "/api/activities",
  shareBaseUrl = null,
  onCreateShareLink,
}: GarminActivityMapCardProps): React.ReactNode {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const eligible = activities
    .filter((activity) => (activity.sampleCount ?? 0) > 0)
    .sort((a, b) => b.startTimeGmt.localeCompare(a.startTimeGmt));

  const [localActivityId, setLocalActivityId] = useState<string | null>(
    () => activityId ?? eligible[0]?.id ?? null
  );
  const selectedActivityId = activityId === undefined ? localActivityId : activityId;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageStatus, setImageStatus] = useState<"idle" | "copying" | "copied" | "downloaded" | "error">("idle");
  const [imageError, setImageError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");

  const selectedActivity = eligible.find((activity) => activity.id === selectedActivityId) ?? null;
  const detail = useActivityDetail(selectedActivityId, detailUrlPrefix);
  const samples = detail?.samples ?? null;
  const splits = detail?.splits ?? [];

  const elevationDomain = useMemo(() => {
    if (!samples) return null;
    const values = samples
      .map((sample) => sample.elevationMeters)
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [samples]);

  const gpsSampleCount = samples?.filter((sample) => (
    typeof sample.latitude === "number" && typeof sample.longitude === "number"
  )).length ?? 0;
  const hasMap = gpsSampleCount >= 2;
  const hasSamples = samples !== null && samples.length > 0;
  const showPicker = eligible.length > 0;

  const selectedSample = selectedIndex !== null ? samples?.[selectedIndex] : undefined;
  const selectedSpeed = selectedSample?.speedMetersPerSecond ?? null;
  const selectedPace = selectedSpeed && selectedSpeed > 0
    ? METERS_PER_MILE / selectedSpeed / 60
    : null;
  const derivedAveragePace = selectedActivity
    ? (selectedActivity.averagePaceMinutesPerMile ?? null)
    : null;

  const handleActivityChange = (id: string): void => {
    if (!id) return;
    if (onActivityChange) {
      onActivityChange(id);
    } else {
      setLocalActivityId(id);
    }
    setSelectedIndex(null);
  };

  const handleCopyImage = async (): Promise<void> => {
    if (!cardRef.current || !selectedActivity || !detail) return;
    setImageStatus("copying");
    setImageError(null);
    try {
      await document.fonts?.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      const exportWidth = Math.max(cardRef.current.offsetWidth, cardRef.current.scrollWidth);
      const exportHeight = cardRef.current.scrollHeight;
      const blob = await toBlob(cardRef.current, {
        backgroundColor: "#ffffff",
        cacheBust: true,
        width: exportWidth,
        height: exportHeight,
        pixelRatio: 2,
        skipFonts: true,
        style: { overflow: "visible" },
        filter: (node) => !(node instanceof HTMLElement && node.dataset.exportIgnore === "true"),
      });
      if (!blob) throw new Error("Unable to render run card");

      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          setImageStatus("copied");
          return;
        } catch {
          // Fall back to a download when image clipboard writes are blocked.
        }
      }

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${selectedActivity.localDate}-run-card.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      setImageStatus("downloaded");
    } catch (error) {
      console.error("Failed to copy run card image:", error);
      setImageError(error instanceof Error ? error.message : "The browser could not render this card.");
      setImageStatus("error");
    }
  };

  const handleCopyShareLink = async (): Promise<void> => {
    if (!selectedActivity) return;
    setShareStatus("copying");
    try {
      const baseUrl = shareBaseUrl ?? await onCreateShareLink?.();
      if (!baseUrl) throw new Error("Unable to create share link");
      const runUrl = buildSharedRunUrl(baseUrl, selectedActivity.id, window.location.origin);
      await navigator.clipboard.writeText(runUrl);
      setShareStatus("copied");
    } catch {
      setShareStatus("error");
    }
  };

  useEffect(() => {
    setSelectedIndex(null);
    setImageStatus("idle");
    setImageError(null);
    setShareStatus("idle");
  }, [selectedActivityId]);


  if (!showPicker) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <CardHeader />
        <div className="p-5">
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            No runs with stored sample detail yet. Import activity detail from{" "}
            <a
              href="/plan?view=current&tab=settings#garmin-detail-sync"
              className="font-medium text-enduro-700 underline"
            >
              Garmin settings
            </a>{" "}
            and each route, with per-minute pace, heart rate, power, cadence, elevation, and
            temperature, will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={cardRef} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <CardHeader />
        <div data-export-ignore="true" className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="min-w-0 sm:w-72">
            <span className="sr-only">Choose a run</span>
            <select
              value={selectedActivityId ?? ""}
              onChange={(event) => handleActivityChange(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              {eligible.map((activity) => (
                <option key={activity.id} value={activity.id}>
                  {activity.localDate} · {activity.activityName} · {activity.distanceMiles.toFixed(1)} mi
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyImage}
              disabled={!detail || imageStatus === "copying"}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {imageStatus === "copying" ? "Rendering..." : imageStatus === "copied" ? "Image copied" : imageStatus === "downloaded" ? "PNG downloaded" : imageStatus === "error" ? "Try again" : "Copy image"}
            </button>
            <button
              type="button"
              onClick={handleCopyShareLink}
              disabled={!selectedActivity || shareStatus === "copying"}
              className="rounded-lg bg-enduro-700 px-3 py-2 text-xs font-semibold text-white hover:bg-enduro-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {shareStatus === "copying" ? "Creating..." : shareStatus === "copied" ? "Link copied" : shareStatus === "error" ? "Try again" : "Share"}
            </button>
          </div>
        </div>
      </div>

      <div className={imageStatus === "copying" ? "space-y-5 p-5" : "grid gap-5 p-5 lg:grid-cols-5"}>
        {/* Route map + summary */}
        <div className={imageStatus === "copying" ? undefined : "lg:col-span-3"}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-gray-500">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              {selectedActivity && (
                <>
                  <strong className="text-sm text-gray-900">{selectedActivity.activityName}</strong>
                  <span>{selectedActivity.localDate}</span>
                  <span>{selectedActivity.distanceMiles.toFixed(2)} mi</span>
                  {selectedActivity.durationSeconds > 0 && <span>{formatElapsed(selectedActivity.durationSeconds)}</span>}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> start
                <span className="ml-2 inline-block h-2 w-2 rounded-full bg-red-500" /> finish
              </span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
                Scroll to zoom · drag to pan · click a point
              </span>
            </div>
          </div>

          <div className="mt-3 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            {hasMap ? (
              <GarminActivityLeafletMap
                key={imageStatus === "copying" ? "export-map" : "interactive-map"}
                samples={samples ?? []}
                selectedIndex={selectedIndex}
                onPointSelect={(index) => {
                  setSelectedIndex((current) => (current === index ? null : index));
                }}
              />
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 p-6 text-center">
                <p className="text-sm font-medium text-gray-500">No GPS route available</p>
                <p className="max-w-sm text-xs text-gray-400">
                  This run has stored samples but fewer than two GPS points, so a route cannot be drawn.
                  Sample details below are still available when a point is chosen from the trace.
                </p>
              </div>
            )}

            {elevationDomain && (
              <div className="flex items-center gap-2 border-t border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500">
                <span>{Math.round(elevationDomain.min)} m</span>
                <span className="mx-1 h-1.5 w-16 rounded-full bg-gradient-to-r from-emerald-600 via-amber-500 to-red-600" />
                <span>{Math.round(elevationDomain.max)} m elevation</span>
              </div>
            )}
          </div>

          {selectedActivity && (
            <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
              <RouteMetric label="Distance" value={`${selectedActivity.distanceMiles.toFixed(1)} mi`} />
              <RouteMetric label="Time" value={selectedActivity.durationSeconds > 0 ? formatElapsed(selectedActivity.durationSeconds) : "--"} />
              <RouteMetric label="Avg pace" value={derivedAveragePace ? `${formatPace(derivedAveragePace)}/mi` : "--"} />
              <RouteMetric label="Elev. gain" value={selectedActivity.elevationGainMeters ? `${Math.round(selectedActivity.elevationGainMeters)} m` : "--"} />
              <RouteMetric label="Avg HR" value={selectedActivity.averageHeartRate ? `${Math.round(selectedActivity.averageHeartRate)} bpm` : "--"} />
              <RouteMetric label="Max HR" value={selectedActivity.maxHeartRate ? `${Math.round(selectedActivity.maxHeartRate)} bpm` : "--"} />
              <RouteMetric label="Avg power" value={selectedActivity.averagePower ? `${Math.round(selectedActivity.averagePower)} W` : "--"} />
              <RouteMetric label="Avg cadence" value={selectedActivity.averageCadence ? `${Math.round(selectedActivity.averageCadence)} spm` : "--"} />
              <RouteMetric label="Calories" value={selectedActivity.calories ? `${Math.round(selectedActivity.calories)} kcal` : "--"} />
              <RouteMetric label="Device" value={selectedActivity.deviceName ?? "--"} />
              <RouteMetric label="Samples" value={selectedActivity.sampleCount > 0 ? selectedActivity.sampleCount.toLocaleString() : "--"} />
              <RouteMetric label="Quality" value={selectedActivity.qualityScore != null ? `${selectedActivity.qualityScore}/100` : "--"} />
            </div>
          )}

        </div>

        {/* Selected point detail */}
        {imageStatus !== "copying" && <div className="lg:col-span-2">
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4">
            <div className="flex items-baseline justify-between">
              <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">Sample point</h4>
              {selectedIndex !== null && (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">selected</span>
              )}
            </div>

            {selectedSample ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-gray-500">Elapsed</span>
                  <span className="font-medium tabular-nums text-gray-900">{formatElapsed(selectedSample.elapsedSeconds)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <DetailMetric label="Pace" value={selectedPace ? `${formatPace(selectedPace)}/mi` : "--"} />
                  <DetailMetric label="Heart rate" value={selectedSample.heartRate != null ? `${Math.round(selectedSample.heartRate)} bpm` : "--"} />
                  <DetailMetric label="Power" value={selectedSample.power != null ? `${Math.round(selectedSample.power)} W` : "--"} />
                  <DetailMetric label="Cadence" value={selectedSample.cadence != null ? `${Math.round(selectedSample.cadence)} spm` : "--"} />
                  <DetailMetric label="Elevation" value={typeof selectedSample.elevationMeters === "number" ? `${selectedSample.elevationMeters.toFixed(1)} m` : "--"} />
                  <DetailMetric label="Temperature" value={typeof selectedSample.temperatureCelsius === "number" ? `${Math.round(selectedSample.temperatureCelsius)} °C` : "--"} />
                </div>
                <p className="text-[11px] leading-4 text-gray-400">
                  Pace and speed come from the per-minute sample. Per-sample distance and grade are not stored on
                  real Garmin detail, so route metrics use the run summary.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-2 text-sm text-gray-600">
                {hasSamples ? (
                  <p>Click a point on the route to see its stored minute-by-minute sample. The selected point is highlighted in amber.</p>
                ) : (
                  <p>This run has sample metadata but no per-minute trace is loaded. Choose another run, or import newer detail from Settings.</p>
                )}
              </div>
            )}
          </div>
        </div>}

        {selectedActivity && detail && (
          <div className={imageStatus === "copying" ? undefined : "lg:col-span-5"}>
            <MileSplits
              splits={splits}
              hasMeasuredPower={!selectedActivity.powerSource?.startsWith("estimated_")}
              exporting={imageStatus === "copying"}
            />
          </div>
        )}
      </div>
      {imageError && (
        <p data-export-ignore="true" role="alert" className="border-t border-red-100 bg-red-50 px-5 py-2 text-xs text-red-700">
          Image export failed: {imageError}
        </p>
      )}
    </div>
  );
}

function MileSplits({
  splits,
  hasMeasuredPower,
  exporting,
}: {
  splits: ActivitySplit[];
  hasMeasuredPower: boolean;
  exporting: boolean;
}): React.ReactNode {
  return (
    <section className="overflow-hidden rounded-lg border border-gray-200">
      <div className="flex items-baseline justify-between gap-3 border-b border-gray-200 bg-slate-50 px-4 py-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-700">Mile splits</h4>
          <p className="mt-0.5 text-[11px] text-gray-500">Calculated from the full recorded trace.</p>
        </div>
        <span className="text-[10px] text-gray-400">Elevation: gain / loss</span>
      </div>
      {splits.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-500">
          Splits are unavailable because this trace does not contain enough valid speed data.
        </p>
      ) : (
        <div className={exporting ? "overflow-visible" : "overflow-x-auto"}>
          <table className="w-full min-w-[690px] text-left text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Mile</th>
                <th className="px-3 py-2 font-medium">Split</th>
                <th className="px-3 py-2 font-medium">Pace</th>
                <th className="px-3 py-2 font-medium">Avg HR</th>
                <th className="px-3 py-2 font-medium">Avg power</th>
                <th className="px-3 py-2 font-medium">Cadence</th>
                <th className="px-3 py-2 font-medium">Elevation</th>
                <th className="px-3 py-2 font-medium">Temp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {splits.map((split) => (
                <tr key={split.number} className="tabular-nums text-gray-700">
                  <td className="px-3 py-2.5 font-semibold text-gray-900">
                    {split.number}
                    {split.distanceMiles < 0.995 && (
                      <span className="ml-1 font-normal text-gray-400">({split.distanceMiles.toFixed(2)} mi)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-gray-900">{formatElapsed(split.durationSeconds)}</span>
                    <span className="block text-[10px] text-gray-400">{formatElapsed(split.elapsedSeconds)} elapsed</span>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-enduro-800">
                    {split.paceMinutesPerMile !== null ? `${formatPace(split.paceMinutesPerMile)}/mi` : "--"}
                  </td>
                  <td className="px-3 py-2.5">{split.averageHeartRate !== null ? `${Math.round(split.averageHeartRate)} bpm` : "--"}</td>
                  <td className="px-3 py-2.5">
                    {hasMeasuredPower && split.averagePower !== null ? `${Math.round(split.averagePower)} W` : "--"}
                  </td>
                  <td className="px-3 py-2.5">{split.averageCadence !== null ? `${Math.round(split.averageCadence)} spm` : "--"}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-emerald-700">+{Math.round(split.elevationGainMeters)} m</span>
                    <span className="ml-1 text-gray-400">/</span>
                    <span className="ml-1 text-rose-700">-{Math.round(split.elevationLossMeters)} m</span>
                  </td>
                  <td className="px-3 py-2.5">{split.averageTemperatureCelsius !== null ? `${Math.round(split.averageTemperatureCelsius)} °C` : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CardHeader(): React.ReactNode {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-950 text-xs font-black text-white">G</span>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Garmin Run Map</h3>
        <p className="text-xs text-gray-500">Route and per-minute sample data for your runs.</p>
      </div>
    </div>
  );
}

function RouteMetric({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="rounded-lg bg-enduro-50 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-enduro-700">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-enduro-900">{value}</p>
    </div>
  );
}

function DetailMetric({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium tabular-nums text-gray-900">{value}</span>
    </div>
  );
}
