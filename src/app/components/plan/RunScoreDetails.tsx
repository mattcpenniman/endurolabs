/** Run score badges and explainable component breakdown. */
"use client";
import React from "react";
import type { RunScore, RunScoreSummary } from "@/lib/analytics/run-score";
import { useUnits } from "@/app/components/units/UnitsProvider";
import { formatPaceForSystem, paceUnitSuffix } from "@/lib/units/format";

export function RunScoreBadge({ score }: { score?: RunScore | null }): React.ReactNode {
  return <span className="rounded bg-enduro-50 px-2 py-1 text-xs font-semibold text-enduro-800"
    title={score?.score != null ? `${score.version}: ${score.availableWeight}% of components available` : "No scoreable metrics available"}>
    Score {score?.score != null ? `${score.score.toFixed(1)}/10${score.partial ? " · partial" : ""}` : "—"}
  </span>;
}

export function RunScoreSummaryBadge({ summary, label }: { summary: RunScoreSummary; label: string }): React.ReactNode {
  const [isOpen, setIsOpen] = React.useState(false);
  const panelId = React.useId();
  return <div className="text-left">
    <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} aria-controls={panelId}
      aria-label={`${label} average run score: ${summary.score === null ? "unavailable" : `${summary.score.toFixed(1)} out of 10`}. ${isOpen ? "Hide" : "Show"} breakdown`}
      className="inline-flex flex-wrap items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-enduro-800 shadow-sm hover:bg-enduro-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-enduro-600">
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
        <path d="M4 16V9m6 7V4m6 12v-6M2 17h16" />
      </svg>
      <span>Avg run score {summary.score === null ? "—" : `${summary.score.toFixed(1)}/10`} · {summary.scored}/{summary.total} runs
        {summary.partial > 0 && ` · ${summary.partial} partial`}</span>
      <span aria-hidden="true">{isOpen ? "▴" : "▾"}</span>
    </button>
    {isOpen && <section id={panelId} aria-label={`${label} run score breakdown`} className="mt-2 space-y-3 rounded-xl border border-enduro-100 bg-white p-4">
      <h4 className="text-sm font-semibold text-gray-900">{label} · Average run score breakdown</h4>
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.components.map((component) => <div key={component.key} className="rounded-lg bg-gray-50 p-3">
          <p className="text-xs font-semibold text-gray-700">{component.label} · {component.weight}%</p>
          <p className="mt-1 text-lg font-bold text-enduro-800">{component.score === null ? "—" : `${component.score.toFixed(1)}/10`}</p>
          <p className="text-xs text-gray-500">{component.scored}/{summary.total} runs with this component</p>
        </div>)}
      </div>
      <p className="text-xs leading-relaxed text-gray-600">
        Equal-run average of {summary.scored} scored runs; {summary.total - summary.scored} unscored and {summary.partial} partial.
        Missing scores and analytics-excluded runs are omitted. Component averages use only available values.
        Each run renormalizes its available weights, so component averages may not combine to the overall average.
      </p>
      <p className="text-xs text-gray-500">Execution coaching heuristic, not a validated fitness or race-readiness metric.</p>
    </section>}
  </div>;
}

export default function RunScoreDetails({ score }: { score?: RunScore | null }): React.ReactNode {
  const { units } = useUnits();
  return <section className="space-y-4 p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h4 className="font-semibold text-gray-900">Run score</h4>
        <p className="mt-1 text-xs text-gray-500">Execution coaching heuristic · {score?.version ?? "run-score-v1"}</p></div>
      <RunScoreBadge score={score} />
    </div>
    {!score ? <p className="text-sm text-gray-500">Score details are unavailable for this run.</p> : <>
      <div className="grid gap-3 md:grid-cols-3">
        {score.components.map((component) => <div key={component.key} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center justify-between gap-2"><h5 className="text-sm font-semibold text-gray-800">{component.label}</h5>
            <span className="text-xs text-gray-500">{component.weight}%</span></div>
          <p className="mt-2 text-2xl font-bold text-enduro-800">{component.score === null ? "—" : `${component.score.toFixed(1)}/10`}</p>
          <p className="mt-2 text-xs font-medium text-gray-700">{component.basis}</p>
          {component.coverage !== null && <p className="mt-1 text-xs text-gray-500">Trace coverage {Math.round(component.coverage * 100)}%</p>}
          <p className="mt-2 text-xs leading-relaxed text-gray-600">{component.detail}</p>
        </div>)}
      </div>
      {score.effortTargets?.length > 0 && <div className="rounded-xl border border-gray-200 p-4">
        <h5 className="text-sm font-semibold text-gray-800">Prescribed effort targets</h5>
        <ol className="mt-2 space-y-2 text-xs text-gray-600">
          {score.effortTargets.map((target, index) => <li key={index} className="flex flex-wrap justify-between gap-2">
            <span>{index + 1}. {target.label} · {(target.seconds / 60).toFixed(1)} min</span>
            <span>{formatPaceForSystem(target.pace[0], units)}–{formatPaceForSystem(target.pace[1], units)}{paceUnitSuffix(units)}
              {target.power && ` · ${Math.round(target.power[0])}–${Math.round(target.power[1])} W`}</span>
          </li>)}
        </ol>
      </div>}
      <p className="text-xs leading-relaxed text-gray-500">
        {score.partial ? `Partial score: ${score.availableWeight}% of the component weight is available. Missing components are omitted and the remaining weights are renormalized. ` : "Weighted average: cadence 30%, effort 50%, distance 20%. "}
        Cadence uses your 180 spm goal, not a universal ideal. Faster or higher-power running earns no extra credit beyond the prescribed target.
        Modeled watts are never graded as measured power. This score is not a validated fitness or race-readiness metric.
      </p>
    </>}
  </section>;
}
