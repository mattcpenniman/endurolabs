#!/usr/bin/env node

/** Compares the planned training load of two stored plans. */

import postgres from "postgres";
import { comparePlanTraining } from "../src/lib/planner/plan-comparison";
import { formatPace } from "../src/lib/training/models";
import type { MarathonPlan } from "../src/lib/training/models";
import type { PlanComparisonMetric } from "../src/lib/planner/plan-comparison";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

interface PlanRow {
  id: string;
  userId: string | null;
  raceName: string | null;
  planData: MarathonPlan;
  createdAt: Date;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): void {
  console.error(`Usage:
  npm run plan:compare -- --email runner@example.com [--against PLAN_ID] [--json]
  npm run plan:compare -- --plan-id PLAN_ID [--against PLAN_ID] [--json]

  Compares planned volume, time near peak, long-run exposure, specific
  work, recovery weeks, and taper between two stored plans. Plans are
  labeled Before/After by creation time.

  --email EMAIL    Compare the athlete's current plan with the previous cycle.
  --plan-id ID     Compare this plan with the previous cycle.
  --against ID     Compare against this specific plan instead.
  --json           Print the comparison as JSON.

  Without --against, the previous cycle is the same athlete's plan with the
  latest race date before the subject plan's race, falling back to the most
  recently created other plan.`);
}

function secondsToHMS(secs: number): string {
  const totalSecs = Math.max(0, Math.round(secs));
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatValue(value: number | null, unit: PlanComparisonMetric["unit"]): string {
  if (value == null || !Number.isFinite(value)) return "—";
  switch (unit) {
    case "count":
      return String(Math.round(value));
    case "miles":
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    case "minutes":
      return secondsToHMS(value * 60);
    case "pace":
      return formatPace(value);
    case "percent":
      return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
  }
}

function formatDelta(metric: PlanComparisonMetric): string {
  if (metric.delta == null) return "—";
  if (metric.delta === 0) return "0";

  const direction = metric.delta > 0 ? "+" : "-";
  const magnitude = Math.abs(metric.delta);

  switch (metric.unit) {
    case "count":
      return `${direction}${Math.round(magnitude)}${metric.deltaPercent != null ? ` (${direction}${Math.abs(metric.deltaPercent)}%)` : ""}`;
    case "miles": {
      const value = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1);
      return `${direction}${value}${metric.deltaPercent != null ? ` (${direction}${Math.abs(metric.deltaPercent)}%)` : ""}`;
    }
    case "minutes":
      return `${direction}${secondsToHMS(magnitude * 60)}`;
    case "pace":
      return `${direction}${formatPace(magnitude)}/mi`;
    case "percent": {
      const value = Number.isInteger(magnitude) ? String(magnitude) : magnitude.toFixed(1);
      return `${direction}${value} pp`;
    }
  }
}

function describePlan(row: PlanRow, summary: { totalWeeks: number; startDate: string; endDate: string; goalMinutes: number | null; marathonPace: number | null }): string {
  const name = row.raceName ?? row.planData.runnerProfile.raceName ?? "Unnamed plan";
  const start = summary.startDate.slice(0, 10);
  const end = summary.endDate.slice(0, 10);
  const goal = summary.goalMinutes != null ? `, goal ${secondsToHMS(summary.goalMinutes * 60)}` : "";
  const pace = summary.marathonPace != null ? `, MP ${formatPace(summary.marathonPace)}/mi` : "";
  return `${name} (id ${row.id.slice(0, 8)}, ${summary.totalWeeks} weeks, ${start} → ${end}${goal}${pace})`;
}

/** Legacy plans may store plan_data as a JSON string; normalize before use. */
function normalizePlan(row: PlanRow): PlanRow {
  const data = row.planData as unknown;
  if (typeof data === "string") {
    return { ...row, planData: JSON.parse(data) as MarathonPlan };
  }
  return row;
}

const apply = process.argv.includes("--apply");
const asJson = process.argv.includes("--json");
const planId = argument("plan-id")?.trim();
const againstId = argument("against")?.trim();
const email = argument("email")?.trim().toLowerCase();

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  if (apply) throw new Error("plan:compare is read-only; --apply is not supported");
  if (planId && email) throw new Error("Provide exactly one of --plan-id or --email");
  if (!planId && !email) {
    usage();
    throw new Error("Provide exactly one of --plan-id or --email");
  }
  if (againstId && againstId === planId) throw new Error("--against must differ from --plan-id");

  let athleteEmail: string | null = null;
  let anchor: PlanRow;

  if (planId) {
    const [row] = await sql<PlanRow[]>`
      select id, user_id as "userId", race_name as "raceName", plan_data as "planData", created_at as "createdAt"
      from plans where id = ${planId} limit 1`;
    if (!row) throw new Error(`Plan not found: ${planId}`);
    anchor = normalizePlan(row);
    if (row.userId) {
      const [owner] = await sql<{ email: string }[]>`select email from users where id = ${row.userId} limit 1`;
      athleteEmail = owner?.email ?? null;
    }
  } else {
    const [user] = await sql<{ id: string; email: string }[]>`
      select id, email from users where email = ${email ?? null} limit 1`;
    if (!user) throw new Error(`User not found: ${email}`);
    athleteEmail = user.email;

    const [current] = await sql<PlanRow[]>`
      select p.id, p.user_id as "userId", p.race_name as "raceName", p.plan_data as "planData", p.created_at as "createdAt"
      from users u join plans p on p.id = u.current_plan_id
      where u.id = ${user.id} limit 1`;
    const [newest] = await sql<PlanRow[]>`
      select id, user_id as "userId", race_name as "raceName", plan_data as "planData", created_at as "createdAt"
      from plans where user_id = ${user.id} order by created_at desc limit 1`;
    const resolved = current ?? newest;
    if (!resolved) throw new Error(`No plans found for ${user.email}`);
    anchor = normalizePlan(resolved);
  }

  let counterpart: PlanRow | null = null;
  if (againstId) {
    const [row] = await sql<PlanRow[]>`
      select id, user_id as "userId", race_name as "raceName", plan_data as "planData", created_at as "createdAt"
      from plans where id = ${againstId} limit 1`;
    if (!row) throw new Error(`Plan not found: ${againstId}`);
    if (anchor.userId && row.userId && row.userId !== anchor.userId) {
      throw new Error("Plans belong to different athletes");
    }
    counterpart = normalizePlan(row);
  } else if (anchor.userId) {
    const anchorRaceDate = anchor.planData.raceDay ?? anchor.planData.runnerProfile?.raceDate ?? null;
    if (anchorRaceDate) {
      const [previous] = await sql<PlanRow[]>`
        select id, user_id as "userId", race_name as "raceName", plan_data as "planData", created_at as "createdAt"
        from plans
        where user_id = ${anchor.userId} and id != ${anchor.id}
          and plan_data->>'raceDay' is not null
          and plan_data->>'raceDay' < ${anchorRaceDate}
        order by plan_data->>'raceDay' desc
        limit 1`;
      counterpart = previous ? normalizePlan(previous) : null;
    }
    if (!counterpart) {
      const [fallback] = await sql<PlanRow[]>`
        select id, user_id as "userId", race_name as "raceName", plan_data as "planData", created_at as "createdAt"
        from plans where user_id = ${anchor.userId} and id != ${anchor.id}
        order by created_at desc limit 1`;
      counterpart = fallback ? normalizePlan(fallback) : null;
    }
  }

  if (!counterpart) {
    throw new Error("Need at least two plans for the athlete to compare");
  }

  const [before, after] =
    anchor.createdAt.getTime() <= counterpart.createdAt.getTime()
      ? [anchor, counterpart]
      : [counterpart, anchor];

  const comparison = comparePlanTraining(before.planData, after.planData);

  if (asJson) {
    console.log(JSON.stringify({
      version: "plan-compare-v1",
      athlete: athleteEmail,
      before: { ...comparison.before, createdAt: before.createdAt },
      after: { ...comparison.after, createdAt: after.createdAt },
      metrics: comparison.metrics,
    }, null, 2));
  } else {
    const labelWidth = Math.max("Metric".length, ...comparison.metrics.map((m) => m.label.length));
    const beforeValues = comparison.metrics.map((m) => formatValue(m.before, m.unit));
    const afterValues = comparison.metrics.map((m) => formatValue(m.after, m.unit));
    const deltaValues = comparison.metrics.map(formatDelta);
    const beforeWidth = Math.max("Before".length, ...beforeValues.map((v) => v.length));
    const afterWidth = Math.max("After".length, ...afterValues.map((v) => v.length));
    const deltaWidth = Math.max("Delta".length, ...deltaValues.map((v) => v.length));

    console.log(`=== Plan Comparison${athleteEmail ? ` — ${athleteEmail}` : ""} ===`);
    console.log(`Before: ${describePlan(before, comparison.before)}`);
    console.log(`After:  ${describePlan(after, comparison.after)}`);
    console.log("");
    console.log(`${"Metric".padEnd(labelWidth)}  ${"Before".padStart(beforeWidth)}  ${"After".padStart(afterWidth)}  ${"Delta".padStart(deltaWidth)}`);
    comparison.metrics.forEach((metric, index) => {
      console.log(
        `${metric.label.padEnd(labelWidth)}  ${beforeValues[index].padStart(beforeWidth)}  ${afterValues[index].padStart(afterWidth)}  ${deltaValues[index].padStart(deltaWidth)}`
      );
    });
    console.log("\nPlanned-load comparison only; it does not predict finish time. Use planner:recommend for the forecast and goal gap.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sql.end();
}