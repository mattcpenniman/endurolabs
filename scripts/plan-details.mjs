#!/usr/bin/env node

/** Read-only saved-plan inspection, usable with Node and the existing postgres dependency. */
import postgres from "postgres";
import { pathToFileURL } from "node:url";

function argument(args, name) {
  const inline = args.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/** Decode legacy JSON-string JSONB and select a week/day without mutating the plan. */
export function selectPlanDetails(value, { date, week } = {}) {
  const plan = typeof value === "string" ? JSON.parse(value) : value;
  if (!plan || !Array.isArray(plan.weeks)) throw new Error("Saved plan has no weeks array");
  if (date !== undefined && week !== undefined) throw new Error("Choose --date or --week, not both");
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      throw new Error("--date must be a valid YYYY-MM-DD calendar date");
    }
    const matches = plan.weeks.flatMap((item) => item.days ?? [])
      .filter((day) => day.date?.slice(0, 10) === date);
    if (matches.length !== 1) throw new Error("Plan must contain exactly one matching calendar day");
    return { date, day: matches[0], paceZones: plan.paceZones, powerZones: plan.powerZones };
  }
  if (week !== undefined) {
    const number = Number(week);
    if (!Number.isInteger(number) || number < 1) throw new Error("--week must be a positive integer");
    const selected = plan.weeks.find((item) => item.weekNumber === number);
    if (!selected) throw new Error(`Plan has no week ${number}`);
    return { week: selected, paceZones: plan.paceZones, powerZones: plan.powerZones };
  }
  return plan;
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log(`Usage:
  npm run plan:details -- --email runner@example.com [--date YYYY-MM-DD | --week N]
  npm run plan:details -- --plan-id UUID [--date YYYY-MM-DD | --week N]
  npm run plan:details -- --email runner@example.com --list

Prints JSON only to stdout. --email selects users.current_plan_id (no newest-plan
guess); --list shows the athlete's plan IDs, race names and current-plan flag.
Without --date/--week the complete saved plan is returned. A selected day includes
both primary and secondary workouts, plus the plan's pace/power zones.
Requires DATABASE_URL, loaded from .env when present. Read-only; does not contact
Garmin, regenerate plans, or change stored data.`);
    return;
  }
  const email = argument(args, "email")?.trim().toLowerCase();
  const planId = argument(args, "plan-id");
  const date = argument(args, "date");
  const week = argument(args, "week");
  const list = args.includes("--list");
  if ((!email && !planId) || (email && planId)) throw new Error("Provide exactly one of --email or --plan-id");
  if (list && (!email || date || week)) throw new Error("--list requires --email and no date/week filter");
  // Validate selectors before opening a connection, including impossible dates.
  if (date !== undefined || week !== undefined) {
    selectPlanDetails({ weeks: [{ weekNumber: Number(week ?? 1), days: [{ date }] }] }, { date, week });
  }
  try { process.loadEnvFile(".env"); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
  try {
    // Read-only transaction is enforced by PostgreSQL, not just CLI convention.
    const result = await sql.begin("read only", async (transaction) => {
      if (list) {
        const plans = await transaction`
          select p.id as "planId", p.race_name as "raceName", p.created_at as "createdAt",
                 (p.id = u.current_plan_id) as "current", p.archived_at as "archivedAt"
          from plans p join users u on u.id=p.user_id
          where u.email=${email} order by p.created_at desc`;
        if (!plans.length) throw new Error("No plans found for this athlete");
        return { plans };
      }
      const rows = planId
        ? await transaction`select id, race_name, plan_data from plans where id=${planId} limit 1`
        : await transaction`select p.id, p.race_name, p.plan_data from users u
            join plans p on p.id=u.current_plan_id and p.user_id=u.id where u.email=${email} limit 1`;
      const row = rows[0];
      if (!row) throw new Error("Plan not found; use --email EMAIL --list to find a saved plan ID");
      return { planId: row.id, raceName: row.race_name, details: selectPlanDetails(row.plan_data, { date, week }) };
    });
    console.log(JSON.stringify(result, null, 2));
  } finally { await sql.end(); }
}

if (process.argv[1] === "-" || (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)) {
  main().catch((error) => {
    // Database errors can carry connection details; return a bounded diagnostic.
    console.error(error.code ? `Plan lookup failed (${error.code})` : error.message);
    process.exitCode = 1;
  });
}
