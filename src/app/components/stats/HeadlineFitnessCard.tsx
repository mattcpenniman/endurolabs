// ============================================================
// EnduroLab — Headline Fitness Card
// ============================================================
// Shows the single most valuable longitudinal number (Power
// @ 140 bpm) with confidence bands, sample support, and a
// transparent methodology note.
// ============================================================

"use client";

import React from "react";
import { PowerHeartRateModel } from "@/lib/analytics/models";

interface HeadlineFitnessCardProps {
  fitness: {
    headline: PowerHeartRateModel | null;
    bestWeekModel: PowerHeartRateModel | null;
    best140: number | null;
    best140Wkg: number | null;
  } | null;
  title: string;
  subtitle: string;
}

function confidencePill(level: string): { label: string; tone: string } {
  switch (level) {
    case "high":
      return { label: "Confidence: High", tone: "bg-enduro-100 text-enduro-700" };
    case "medium":
      return { label: "Confidence: Medium", tone: "bg-amber-100 text-amber-700" };
    case "low":
      return { label: "Confidence: Low", tone: "bg-red-100 text-red-700" };
    case "insufficient":
      return { label: "Insufficient data", tone: "bg-gray-200 text-gray-700" };
    default:
      return { label: "No data", tone: "bg-gray-100 text-gray-500" };
  }
}

function formatCI(lower: number, upper: number): string {
  return `${Math.round(lower)}–${Math.round(upper)} W`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export default function HeadlineFitnessCard({ fitness, title, subtitle }: HeadlineFitnessCardProps) {
  const model = fitness?.bestWeekModel ?? fitness?.headline ?? null;

  if (!fitness || fitness.best140 === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">{subtitle}</h3>
        <p className="mt-3 text-3xl font-bold text-gray-900">— W</p>
        <p className="mt-1 text-sm text-gray-500">
          No sample-level Garmin data available for this window.
        </p>
        <div className="mt-3 text-xs text-gray-500">
          Requires at least ~30 min of steady-aerobic running per plan with
          Garmin power + HR traces.
        </div>
      </div>
    );
  }

  const estimate = model?.estimates.find((e) => e.heartRate === 140);
  const pill = confidencePill(model?.confidence ?? "insufficient");

  return (
    <div className="rounded-xl border border-gray-200 bg-gradient-to-br from-white to-enduro-50 p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {title} — {subtitle}
          </h3>
          <p className="mt-3 text-3xl font-bold tabular-nums text-gray-900">
            {Math.round(fitness.best140)} W
          </p>
          <p className="mt-1 text-sm tabular-nums text-gray-600">
            {fitness.best140Wkg !== null ? (
              <span className="font-medium text-enduro-700">{fitness.best140Wkg.toFixed(2)} W/kg @ 140 bpm</span>
            ) : (
              <span className="text-gray-400">W/kg unavailable (no body weight on file)</span>
            )}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${pill.tone}`}>
          {pill.label}
        </span>
      </div>

      {estimate && model && (
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-4">
          <Metric label="Runs" value={String(model.activityCount)} />
          <Metric label="Running time" value={formatMinutes(model.usableMinutes)} />
          <Metric label="Samples" value={model.sampleCount.toLocaleString()} />
          <Metric label="95% CI" value={formatCI(estimate.lower95, estimate.upper95)} />
        </div>
      )}

      {model && (
        <div className="mt-3 flex items-center gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-enduro-400" /> Interpolated
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-amber-400" /> Extrapolated (&gt; HR range)
          </span>
          <span className="ml-auto hidden sm:inline">
            HR range: {Math.round(model.observedHeartRateRange[0])}–{Math.round(model.observedHeartRateRange[1])} bpm
          </span>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className="font-medium tabular-nums text-gray-900">{value}</div>
    </div>
  );
}
