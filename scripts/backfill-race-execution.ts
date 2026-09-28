#!/usr/bin/env node

/** Recomputes race-execution-v1 analytics for stored race activities from
 *  existing activity_samples. DB-only; never contacts Garmin. */

import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

interface UserRow {
  id: string;
  email: string;
}

interface RaceRow {
  id: string;
  activityName: string;
  localDate: string;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): void {
  console.error(`Usage:
  npm run execution:backfill [-- --email runner@example.com] [--apply] [--json]

  --email runner@example.com  Target one user. Default: first user with race samples.
  --apply                     Persist the recomputed analytics. Without it the command is a preview.
  --json                      Print the report as JSON.

Reads stored activity_samples only. Race execution quality feeds the race
predictor's evidence weighting; execution-limited (blow-up) races are
down-weighted instead of dropped.`);
}

const apply = process.argv.includes("--apply");
const asJson = process.argv.includes("--json");
const email = argument("email");
if (process.argv.includes("--help")) {
  usage();
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  const [user] = await sql<UserRow[]>`
    select u.id, u.email
    from users u
    where ${email ? sql`u.email = ${email}` : sql`exists (
      select 1 from run_activities a
      where a.user_id = u.id and a.event_type = 'race' and a.samples_fetched_at is not null
    )`}
    order by u.created_at
    limit 1`;
  if (!user) throw new Error(email ? `No user found for ${email}` : "No user with race activity samples found");

  const races = await sql<RaceRow[]>`
    select id, activity_name as "activityName", local_date as "localDate"
    from run_activities
    where user_id = ${user.id} and event_type = 'race' and samples_fetched_at is not null
    order by local_date`;

  const { recomputeRaceExecution } = await import("../src/lib/analytics/activity-summary-persistence");
  const rows = [];
  for (const race of races) {
    const analysis = await recomputeRaceExecution(race.id, { dryRun: !apply });
    rows.push({
      date: race.localDate,
      race: race.activityName.slice(0, 30),
      quality: analysis?.quality ?? "-",
      positiveSplitPercent: analysis?.positiveSplitPercent ?? null,
      heartRateFadeBpm: analysis?.heartRateFadeBpm ?? null,
      powerFadePercent: analysis?.powerFadePercent ?? null,
      closing10kDeltaPercent: analysis?.closing10kDeltaPercent ?? null,
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ user: user.email, apply, races: rows }, null, 2));
  } else {
    console.log(`Race execution backfill for ${user.email} (${apply ? "apply" : "preview"})`);
    console.table(rows);
    if (!apply) console.log("Preview only — re-run with --apply to persist.");
  }
} catch (error) {
  console.error("Race execution backfill failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
  const { endDb } = await import("../src/lib/db/client");
  await endDb();
}