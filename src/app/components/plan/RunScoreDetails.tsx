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

export function RunScoreSummaryBadge({ summary }: { summary: RunScoreSummary }): React.ReactNode {
  return <span className="rounded-lg bg-white px-3 py-2 text-xs text-enduro-800 shadow-sm"
    title="Equal-run average; missing scores and analytics-excluded runs are omitted.">
    Run score {summary.score === null ? "—" : `${summary.score.toFixed(1)}/10`} · {summary.scored}/{summary.total} runs
    {summary.partial > 0 && ` · ${summary.partial} partial`}
  </span>;
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
