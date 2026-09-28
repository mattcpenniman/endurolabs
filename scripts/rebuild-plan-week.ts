#!/usr/bin/env node

/** Rebuilds a single week of a stored plan from the current plan generator. */

import postgres from "postgres";
import type { MarathonPlan, WeeklyPlan } from "../src/lib/training/models";
import { rebuildPlanWeek } from "../src/lib/planner/plan-week-rebuild";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

interface PlanRow {
  id: string;
  planData: MarathonPlan;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** postgres.js serializes JSONB via sql.json(); a plain object is not JSONValue by default. */
function toJson(value: unknown): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

function usage(): void {
  console.error(`Usage:
  npm run plan:rebuild-week -- --plan-id UUID [--week N] [--apply] [--json]
  npm run plan:rebuild-week -- --email runner@example.com [--week N] [--apply] [--json]

  --week N   Rebuild week N (1-based). Defaults to the final week (race week).
  --apply    Persist the rebuilt week. Without it the command is a preview.
  --json     Print the report as JSON.

Regenerates one week from the stored runner profile and splices it back in,
leaving every other week untouched. Refuses when the stored week start date
does not line up with the regenerated week, or when activities or run logs
already reference workouts inside the week being replaced.`);
}

function describeWeek(week: WeeklyPlan): string {
  return week.days
    .map((day) => {
      const date = day.date.slice(0, 10);
      const workout = day.isRestDay ? "Rest" : day.workout?.title ?? "Rest";
      return `  ${day.dayOfWeek.padEnd(9)} ${date}  ${day.isRaceDay ? "RACE  " : ""}${workout}`;
    })
    .join("\n");
}

const apply = process.argv.includes("--apply");
const asJson = process.argv.includes("--json");
const planId = argument("plan-id")?.trim();
const email = argument("email")?.trim().toLowerCase();
const weekArg = argument("week");
const weekNumber = weekArg === undefined ? undefined : Number(weekArg);

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  if ((!planId && !email) || (planId && email)) {
    usage();
    throw new Error("Provide exactly one of --plan-id or --email");
  }
  if (weekNumber !== undefined && (!Number.isInteger(weekNumber) || weekNumber < 1)) {
    throw new Error("--week must be a positive integer");
  }

  let planRows: PlanRow[];
  if (planId) {
    planRows = await sql<PlanRow[]>`
      select id, plan_data as "planData" from plans where id = ${planId} limit 1`;
  } else {
    planRows = await sql<PlanRow[]>`
      select p.id, p.plan_data as "planData"
      from users u join plans p on p.id = u.current_plan_id
      where u.email = ${email ?? null} limit 1`;
  }
  const planRow = planRows[0];
  if (!planRow) throw new Error("Plan not found");

  const plan = planRow.planData;
  const result = rebuildPlanWeek(plan, { weekNumber });
  const storedWeek = plan.weeks.find((week) => week.weekNumber === result.summary.weekNumber);
  if (!storedWeek) throw new Error(`Plan has no week ${result.summary.weekNumber}`);

  let references: Array<{ source: string; count: number }> = [];
  if (result.replacedWorkoutIds.length > 0) {
    references = (await sql<Array<{ source: string; count: number }>>`
      select 'activity' as source, count(*)::int as count
      from run_activities
      where plan_id = ${planRow.id} and planned_workout_id in ${sql(result.replacedWorkoutIds)}
      union all
      select 'log' as source, count(*)::int as count
      from plan_run_logs
      where plan_id = ${planRow.id} and planned_workout_id in ${sql(result.replacedWorkoutIds)}
    `).filter((row) => row.count > 0);
  }

  if (apply && references.length > 0) {
    const detail = references.map((row) => `${row.count} ${row.source}(s)`).join(" and ");
    throw new Error(
      `Refusing to apply: ${detail} reference workouts in week ${result.summary.weekNumber}. Re-align or clear them first.`
    );
  }

  if (apply) {
    await sql`update plans set plan_data = ${sql.json(toJson(result.plan))}, updated_at = now() where id = ${planRow.id}`;
  }

  const replacement = result.plan.weeks.find((week) => week.weekNumber === result.summary.weekNumber);
  if (asJson) {
    console.log(JSON.stringify({
      mode: apply ? "applied" : "preview",
      planId: planRow.id,
      summary: result.summary,
      references,
      before: storedWeek,
      after: replacement,
    }, null, 2));
  } else {
    console.log(`${apply ? "Applied" : "Preview of"} rebuild for week ${result.summary.weekNumber} (${result.summary.startDate} to ${result.summary.endDate})${result.summary.isRaceWeek ? " — race week" : ""}.`);
    console.log(`\nBefore (${result.summary.previousTotalMileage} mi, long run ${result.summary.previousLongRun} mi):`);
    console.log(describeWeek(storedWeek));
    console.log(`\nAfter (${result.summary.totalMileage} mi, long run ${result.summary.longRunDistance} mi):`);
    if (replacement) console.log(describeWeek(replacement));
    if (references.length > 0) {
      console.log(`\nWarning: ${references.map((row) => `${row.count} ${row.source}(s)`).join(" and ")} reference the current week's workouts.`);
    }
    if (!apply) console.log("\nRun again with --apply to persist.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await sql.end();
}
