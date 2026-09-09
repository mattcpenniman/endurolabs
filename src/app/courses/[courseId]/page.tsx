// ============================================================
// EnduroLab - Course Detail
// ============================================================
// /courses/<id> — summary of one saved course and the actions to
// open the elevation comparison, optionally against another saved
// course.

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useParams } from "next/navigation";
import { useUnits } from "@/app/components/units/UnitsProvider";
import { formatElevationFeet, formatGrade } from "@/lib/units/format";

interface BandRow {
  key: string;
  label: string;
  distanceMeters: number;
  sharePercent: number;
}

interface CourseRow {
  id: string;
  name: string;
  distanceMeters: number;
  distanceMiles: number;
  elevationGainFeet: number;
  elevationGainFeetPerMile: number | null;
  created: string;
  pointCount: number;
  gradeBands: BandRow[];
  elevationSource: "gpx" | "open-elevation";
}

export default function CourseDetailPage(): React.ReactNode {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const { units } = useUnits();
  const id = params?.courseId ?? "";
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [allCourses, setAllCourses] = useState<CourseRow[]>([]);
  const [bands, setBands] = useState<BandRow[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const response = await fetch("/api/courses");
      if (response.status === 401) {
        router.replace("/login?redirect=/courses");
        return;
      }
      const body = (await response.json()) as { courses?: CourseRow[] } & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to load courses");
      const list = body.courses ?? [];
      if (!cancelled) {
        setAllCourses(list);
        const found = list.find((row) => row.id === id);
        setCourse(found ?? null);
        setBands(found?.gradeBands ?? []);
      }
    };
    load()
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, router]);

  const openComparison = useCallback((referenceId?: string): void => {
    const reference = referenceId && allCourses.some((row) => row.id === referenceId)
      ? `&reference=${encodeURIComponent(referenceId)}`
      : "";
    router.push(`/courses/${id}/compare?target=${encodeURIComponent(id)}${reference}`);
  }, [id, allCourses, router]);

  const runBackfill = useCallback(async (): Promise<void> => {
    setBackfilling(true);
    setBackfillMessage(null);
    setBackfillError(null);
    try {
      const response = await fetch(`/api/courses/${encodeURIComponent(id)}/elevation`, {
        method: "POST",
      });
      const body = (await response.json()) as { message?: string; backfilled?: number } & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Elevation backfill failed");
      setBackfillMessage(body.message ?? "Elevation backfilled.");
      const listResponse = await fetch("/api/courses");
      const listBody = (await listResponse.json()) as { courses?: CourseRow[] };
      const all = listBody.courses ?? [];
      setAllCourses(all);
      setCourse(all.find((row) => row.id === id) ?? null);
      setBands(all.find((row) => row.id === id)?.gradeBands ?? []);
    } catch (backfillCaught) {
      setBackfillError(backfillCaught instanceof Error ? backfillCaught.message : "Elevation backfill failed");
    } finally {
      setBackfilling(false);
    }
  }, [id]);

  if (loading) {
    return (
      <div className="section-padding">
        <div className="container-narrow animate-pulse space-y-4">
          <div className="h-24 rounded-[2rem] bg-slate-200" />
          <div className="h-64 rounded-[2rem] bg-slate-100" />
        </div>
      </div>
    );
  }

  const otherCourses = allCourses.filter((row) => row.id !== id);

  if (error || !course) {
    return (
      <div className="section-padding">
        <div className="container-narrow space-y-4">
          <button
            type="button"
            onClick={() => router.push("/courses")}
            className="text-sm text-enduro-700 hover:underline"
          >
            Back to courses
          </button>
          <div className="rounded-[2rem] border border-red-200 bg-red-50 p-8 text-sm text-red-800">
            {error ?? "Course not found."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section-padding">
      <div className="container-narrow space-y-6">
        <button
          type="button"
          onClick={() => router.push("/courses")}
          className="text-sm text-enduro-700 hover:underline"
        >
          Back to courses
        </button>

        <header className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-8">
          <h1 className="text-3xl font-bold text-enduro-700">{course.name}</h1>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            {course.distanceMiles.toLocaleString("en-US", { maximumFractionDigits: 2 })} miles
            {" · "}
            {formatElevationFeet(course.elevationGainFeet, units)} of total climbing
            {course.elevationGainFeetPerMile !== null
              ? ` (${formatGrade(course.elevationGainFeetPerMile, units)})`
              : " (no elevation in the GPX)"}
            {" · "}
            {course.pointCount.toLocaleString("en-US")} points
          </p>
        </header>

        {course.elevationGainFeetPerMile === null ? (
          <section className="rounded-[2rem] border border-enduro-300 bg-enduro-50 p-6">
            <h2 className="text-xl font-semibold text-enduro-900">No elevation in this GPX</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-enduro-900/80">
              The uploaded file does not carry per-point elevation, which limits the elevation
              comparison. You can backfill it from Open-Elevation (30 m digital elevation model).
              The values are stored with this course, so the service is not re-queried on later
              visits.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void runBackfill()}
                disabled={backfilling}
                className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700 disabled:opacity-50"
              >
                {backfilling ? "Backfilling…" : "Backfill missing elevation"}
              </button>
              {backfillMessage && (
                <p className="text-sm text-enduro-800">{backfillMessage}</p>
              )}
              {backfillError && (
                <p className="text-sm text-red-700">{backfillError}</p>
              )}
            </div>
          </section>
        ) : course.elevationSource === "open-elevation" ? (
          <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <p className="text-xs text-[var(--color-text-secondary)]">
              Elevation for this course is backfilled from the Open-Elevation 30 m digital elevation
              model (not a barometer/GPS trace), so small undulations are smoothed.
            </p>
          </section>
        ) : null}

        {bands.length > 0 && (
          <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
            <h2 className="text-xl font-semibold">Terrain mix</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {bands.filter((band) => band.sharePercent > 0).map((band) => (
                <span
                  key={band.key}
                  className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1 text-xs"
                >
                  {band.label} — {band.sharePercent}%
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
          <h2 className="text-xl font-semibold">Elevation comparison</h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">
            Compare this course against your stored running history to see the pace-expectation note
            and time-pickup potential. Optionally overlay another saved course.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            {otherCourses.length > 0 ? (
              <label className="flex-1 text-sm">
                <span className="mb-1 block text-[var(--color-text-secondary)]">
                  Overlay another course (optional)
                </span>
                <select
                  id="courses-reference-select"
                  className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm"
                >
                  <option value="">Compare against stored history only</option>
                  {otherCourses.map((row) => (
                    <option key={row.id} value={row.id}>{row.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => {
                const select = document.getElementById("courses-reference-select") as HTMLSelectElement | null;
                openComparison(select?.value || undefined);
              }}
              className="rounded-lg bg-enduro-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-enduro-700"
            >
              Open comparison
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
