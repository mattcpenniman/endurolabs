// ============================================================
// EnduroLab - Course Elevation Comparison
// ============================================================
// /courses/<id>/compare[?reference=<courseId>]
//   Target course elevation profile overlaid on the athlete's
//   recent racing, grade distribution deltas, and a plain-language
//   pace-expectation note tied to the race forecast.

"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import CourseProfileChart from "@/app/components/courses/CourseProfileChart";
import {
  CourseComparisonResult,
} from "@/lib/courses/comparison";

export default function CourseComparePage(): React.ReactNode {
  const params = useParams<{ courseId: string }>();
  const router = useRouter();
  const targetId = params?.courseId ?? "";
  const [data, setData] = useState<CourseComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(window.location.search);
    const reference = search.get("reference");
    const url = reference
      ? `/api/courses/compare?target=${encodeURIComponent(targetId)}&reference=${encodeURIComponent(reference)}`
      : `/api/courses/compare?target=${encodeURIComponent(targetId)}`;
    const load = async (): Promise<void> => {
      const response = await fetch(url);
      if (response.status === 401) {
        router.replace("/login?redirect=/courses");
        return;
      }
      const body = (await response.json()) as CourseComparisonResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to compare courses");
      if (!cancelled) setData(body);
    };
    load()
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [targetId, router]);

  if (loading) {
    return (
      <div className="section-padding">
        <div className="container-narrow animate-pulse space-y-4">
          <div className="h-24 rounded-[2rem] bg-slate-200" />
          <div className="h-96 rounded-[2rem] bg-slate-100" />
          <div className="h-40 rounded-[2rem] bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="section-padding">
        <div className="container-narrow space-y-4">
          <button
            type="button"
            onClick={() => router.push(`/courses/${targetId}`)}
            className="text-sm text-enduro-700 hover:underline"
          >
            Back to course
          </button>
          <div className="rounded-[2rem] border border-red-200 bg-red-50 p-8 text-sm text-red-800">
            {error ?? "Could not load the course comparison."}
          </div>
        </div>
      </div>
    );
  }

  const target = data.target;
  const gradeDelta = data.difference.gradeDistributionDelta;
  const paceDelta = data.difference.paceAdjustmentSecondsPerMile;
  const equivalent = data.difference.equivalentTimeSeconds;

  return (
    <div className="section-padding">
      <div className="container-narrow space-y-6">
        <button
          type="button"
          onClick={() => router.push(`/courses/${targetId}`)}
          className="text-sm text-enduro-700 hover:underline"
        >
          Back to {target.name}
        </button>

        <header className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-8">
          <h1 className="text-3xl font-bold text-enduro-700">
            {target.name} — elevation comparison
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            {target.distanceMiles.toLocaleString("en-US", { maximumFractionDigits: 2 })} miles
            {" · "}
            {data.target.elevationGainFeetPerMile !== null
              ? `${Math.round(data.target.elevationGainFeetPerMile)} ft of climbing per mile`
              : "elevation not present in GPX"}
            {" · "}
            vs. your stored racing
            {data.athlete.elevationGainFeetPerMile !== null
              ? ` (${Math.round(data.athlete.elevationGainFeetPerMile)} ft/mi across ${data.athlete.qualifyingActivities} qualifying runs)`
              : ""}
          </p>
        </header>

        <NoteCard
          difference={data.difference}
          paceAdjustmentSecondsPerMile={paceDelta}
          equivalentSeconds={equivalent}
        />

        <CourseProfileChart profiles={data.profiles} />

        <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
          <h2 className="text-xl font-semibold">Terrain mix comparison</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Percentage of course distance in each grade band. Target vs. the share of your stored
            sample minutes in the matching band (flat, climbing, descending).
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-secondary)]">
                  <th className="py-2 pr-4 font-medium">Grade band</th>
                  <th className="py-2 pr-4 font-medium">{target.name}</th>
                  <th className="py-2 pr-4 font-medium">Your history</th>
                  <th className="py-2 font-medium">Delta</th>
                </tr>
              </thead>
              <tbody>
                {gradeDelta.map((row) => (
                  <tr key={row.label} className="border-b border-[var(--color-border)]">
                    <td className="py-3 pr-4">{row.label}</td>
                    <td className="py-3 pr-4 tabular-nums">{row.targetSharePercent}%</td>
                    <td className="py-3 pr-4 tabular-nums">
                      {row.athleteSharePercent === null ? "—" : `${row.athleteSharePercent}%`}
                    </td>
                    <td className="py-3 tabular-nums">
                      {row.deltaPercent === null
                        ? "—"
                        : `${row.deltaPercent > 0 ? "+" : ""}${row.deltaPercent} pts`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {data.athlete.note && (
          <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Athlete history caveat</p>
            <p className="mt-1 text-amber-800">{data.athlete.note}</p>
          </div>
        )}
        {data.athlete.partialNote && (
          <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            {data.athlete.partialNote}
          </div>
        )}
      </div>
    </div>
  );
}

interface NoteCardProps {
  difference: CourseComparisonResult["difference"];
  paceAdjustmentSecondsPerMile: number | null;
  equivalentSeconds: number | null;
}

function NoteCard({
  difference,
  paceAdjustmentSecondsPerMile,
  equivalentSeconds,
}: NoteCardProps): React.ReactNode {
  const positive = paceAdjustmentSecondsPerMile !== null && paceAdjustmentSecondsPerMile > 0;
  const negative = paceAdjustmentSecondsPerMile !== null && paceAdjustmentSecondsPerMile < 0;
  const tone = positive
    ? { border: "border-enduro-300", bg: "bg-enduro-50", text: "text-enduro-900", heading: "Heavier terrain than your training" }
    : negative
      ? { border: "border-sky-300", bg: "bg-sky-50", text: "text-sky-900", heading: "Flatter terrain than your training" }
      : { border: "border-[var(--color-border)]", bg: "bg-[var(--color-bg)]", text: "text-[var(--color-text)]", heading: "Terrain note" };

  return (
    <section className={`rounded-[2rem] border ${tone.border} ${tone.bg} p-8`}>
      <h2 className={`text-xl font-bold ${tone.text}`}>{tone.heading}</h2>
      <p className={`mt-3 max-w-3xl text-base leading-7 ${tone.text}`}>
        {difference.note}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {difference.deltaFeetPerMile !== null && (
          <span className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-1.5 text-xs">
            {difference.deltaFeetPerMile > 0 ? "+" : ""}
            {Math.round(difference.deltaFeetPerMile).toLocaleString("en-US")} ft/mi vs. your racing
          </span>
        )}
        {paceAdjustmentSecondsPerMile !== null && (
          <span className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-1.5 text-xs">
            ≈ {paceAdjustmentSecondsPerMile > 0 ? "+" : "-"}
            {Math.abs(paceAdjustmentSecondsPerMile)} s/mi pace shift
          </span>
        )}
        {equivalentSeconds !== null && (
          <span className="rounded-lg border border-[var(--color-border)] bg-white/70 px-3 py-1.5 text-xs">
            equivalent to {Math.abs(equivalentSeconds) >= 60
              ? `${Math.floor(Math.abs(equivalentSeconds) / 60)}m ${Math.abs(equivalentSeconds) % 60}s`
              : `${Math.abs(equivalentSeconds)}s`}
            on the full distance
          </span>
        )}
      </div>
      <p className="mt-4 text-xs text-[var(--color-text-secondary)]">
        Sensitivity, not a fitness claim: the shift assumes you hold the same effort as flat ground.
        A larger real-world difference comes from how well the climbs sit inside your training
        distribution (see the terrain mix chart below), not from a change in your fitness.
      </p>
    </section>
  );
}
