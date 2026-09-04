"use client";

// ============================================================
// EnduroLab - Garmin Activity Map Card
// ============================================================
// Interactive run route rendered as an SVG map.  Route metrics
// come from the Garmin activity summary; clicking a route point
// shows the per-minute sample data (HR, power, cadence, pace,
// elevation, temperature) fetched from the sample trace API.

import React, { useEffect, useMemo, useState } from "react";
import type { ActivityChartSample, ActivityDetailResponse, RunActivity } from "@/lib/activities/models";
import GarminActivityLeafletMap from "@/app/components/plan/GarminActivityLeafletMap";

const METERS_PER_MILE = 1609.344;

export interface GarminActivityMapCardProps {
  activities: RunActivity[];
  activityId?: string | null;
  onActivityChange?: (activityId: string) => void;
}

type SampleDetail = ActivityChartSample;

// Module-level cache so an activity trace is fetched at most
// once per tab, across any number of card mounts.
const activitySampleCache = new Map<string, SampleDetail[]>();

function useActivitySamples(activityId: string | null): SampleDetail[] | null {
  const [samples, setSamples] = useState<SampleDetail[] | null>(
    activityId ? activitySampleCache.get(activityId) ?? null : null
  );

  useEffect(() => {
    if (!activityId) {
      setSamples(null);
      return;
    }
    const cached = activitySampleCache.get(activityId);
    if (cached) {
      setSamples(cached);
      return;
    }

    let cancelled = false;
    setSamples(null);
    fetch(`/api/activities/${activityId}`)
      .then(async (response) => {
        const body = (await response.json()) as ActivityDetailResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Failed to load activity detail");
        return body.samples;
      })
      .then((detail) => {
        if (cancelled) return;
        activitySampleCache.set(activityId, detail);
        setSamples(detail);
      })
      .catch(() => {
        if (cancelled) return;
        activitySampleCache.set(activityId, []);
        setSamples([]);
      });

    return () => { cancelled = true; };
  }, [activityId]);

  return samples;
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
}: GarminActivityMapCardProps): React.ReactNode {
  const eligible = activities
    .filter((activity) => (activity.sampleCount ?? 0) > 0)
    .sort((a, b) => b.startTimeGmt.localeCompare(a.startTimeGmt));

  const [localActivityId, setLocalActivityId] = useState<string | null>(
    () => activityId ?? eligible[0]?.id ?? null
  );
  const selectedActivityId = activityId === undefined ? localActivityId : activityId;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const selectedActivity = eligible.find((activity) => activity.id === selectedActivityId) ?? null;
  const samples = useActivitySamples(selectedActivityId);

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

  useEffect(() => {
    setSelectedIndex(null);
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
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-gray-200 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
        <CardHeader />
        <label className="min-w-0 md:w-80">
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
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-5">
        {/* Route map + summary */}
        <div className="lg:col-span-3">
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
        <div className="lg:col-span-2">
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
        </div>
      </div>
    </div>
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
