// ============================================================
// EnduroLab - Courses Page
// ============================================================
// /courses - upload GPX race courses, list saved routes, and open
// a per-course comparison view at /courses/<id>.

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUnits } from "@/app/components/units/UnitsProvider";
import { formatElevationFeet, formatGrade } from "@/lib/units/format";

interface CourseSummary {
  id: string;
  name: string;
  distanceMeters: number;
  distanceMiles: number;
  elevationGainFeet: number;
  elevationGainFeetPerMile: number | null;
  created: string;
  pointCount: number;
}

export default function CoursesPage(): React.ReactNode {
  const router = useRouter();
  const { units } = useUnits();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [courseName, setCourseName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCourses = useCallback(async (): Promise<void> => {
    const response = await fetch("/api/courses");
    if (response.status === 401) {
      router.replace("/login?redirect=/courses");
      return;
    }
    const body = (await response.json()) as { courses?: CourseSummary[] } & { error?: string };
    if (!response.ok) throw new Error(body.error ?? "Failed to load courses");
    setCourses(body.courses ?? []);
  }, [router]);

  useEffect(() => {
    loadCourses()
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [loadCourses]);

  const readGPXFromFile = (file: File): Promise<string> => (
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("Failed to read the GPX file"));
      reader.readAsText(file);
    })
  );

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setUploadMessage(null);
    try {
      const gpx = await readGPXFromFile(file);
      const response = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpx,
          name: courseName.trim() || null,
          filename: file.name,
        }),
      });
      const body = (await response.json()) as { course?: CourseSummary; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Failed to upload course");
      setCourseName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setUploadMessage(`Saved "${body.course?.name ?? file.name}" — clicking it opens the elevation comparison.`);
      await loadCourses();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload course");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (course: CourseSummary): Promise<void> => {
    if (!window.confirm(`Remove "${course.name}"?`)) return;
    const response = await fetch(`/api/courses?id=${encodeURIComponent(course.id)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Failed to delete course");
    }
    await loadCourses();
  };

  const formatDate = (value: string): string => (
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
      .format(new Date(value))
  );

  if (loading) {
    return (
      <div className="section-padding">
        <div className="container-narrow animate-pulse space-y-4">
          <div className="h-28 rounded-[2rem] bg-slate-200" />
          <div className="h-72 rounded-[2rem] bg-slate-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="section-padding">
      <div className="container-narrow space-y-6">
        <header className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-8">
          <h1 className="text-3xl font-bold text-enduro-700">Courses</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-text-secondary)]">
            Upload GPX files of your target race and recent racing. EnduroLab parses the elevation
            profile, compares it against your stored running history, and surfaces a pace-expectation
            note tied to the race forecast.
          </p>
        </header>

        <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
          <h2 className="text-xl font-semibold">Add a course</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            GPX files are read locally, then sent to your account. Up to 5 MB and 50,000 points per file.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <input
              type="text"
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              placeholder="Optional name (e.g. Berlin Marathon 2026)"
              className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".gpx,application/gpx+xml,application/xml,text/xml"
              onChange={(event) => void handleFile(event.target.files?.[0])}
              disabled={uploading}
              className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-enduro-600 file:px-3 file:py-1.5 file:text-white"
            />
          </div>
          {uploadMessage && (
            <p className="mt-3 rounded-lg border border-enduro-200 bg-enduro-50 p-3 text-sm text-enduro-800">
              {uploadMessage}
            </p>
          )}
          {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          )}
        </section>

        <section className="rounded-[2rem] border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold">Saved courses</h2>
            {courses && courses.length > 0 && (
              <span className="text-sm text-[var(--color-text-secondary)]">
                {courses.length} {courses.length === 1 ? "course" : "courses"}
              </span>
            )}
          </div>

          {courses && courses.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-secondary)]">
              No courses saved yet. Upload a GPX file to see its elevation profile and how it compares to your training.
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-[var(--color-border)]">
              {courses?.map((course) => (
                <li key={course.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => router.push(`/courses/${course.id}`)}
                      className="text-left text-base font-semibold text-enduro-700 hover:text-enduro-800"
                    >
                      {course.name}
                    </button>
                    <p className="text-xs text-[var(--color-text-secondary)]">
                      {course.distanceMiles.toLocaleString("en-US", { maximumFractionDigits: 2 })} mi
                      {course.elevationGainFeetPerMile !== null
                        ? ` · ${formatGrade(course.elevationGainFeetPerMile, units)} climbing`
                        : " · no elevation in GPX"}
                      {" · "}
                      {formatElevationFeet(course.elevationGainFeet, units)} of total gain
                      {" · "}
                      {formatDate(course.created)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => router.push(`/courses/${course.id}`)}
                      className="rounded-lg bg-enduro-600 px-4 py-2 text-sm font-medium text-white hover:bg-enduro-700"
                    >
                      Compare & notes
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(course)}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:border-red-400 hover:text-red-600"
                      aria-label={`Delete ${course.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
