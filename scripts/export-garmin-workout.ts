#!/usr/bin/env node
/** Preview or publish exactly one owned planned run through the existing Garmin connection. */
import postgres from "postgres";
import { createFromSession } from "garmin-connect-client";
import type { PersistedSession } from "garmin-connect-client";
import { createHash } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { decryptGarminTokens } from "../src/lib/garmin/crypto";
import type { MarathonPlan } from "../src/lib/training/models";
import { mapGarminWorkout, selectPlannedRun, workoutCalendarDate } from "../src/lib/garmin/workout-export";
import { publishGarminWorkout } from "../src/lib/garmin/workout-publisher";
import type { ExportCheckpoint, WorkoutTransport } from "../src/lib/garmin/workout-publisher";

try { process.loadEnvFile(".env"); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

if (process.argv.includes("--help")) {
  console.log(`Usage: npm run garmin:export-workout -- --email EMAIL --date YYYY-MM-DD
  [--plan-id UUID] [--secondary] [--target pace|power]
  [--apply --journal /private/directory/export.json]

Defaults to the athlete's current plan and primary run. Preview makes no Garmin
requests. Apply uploads and schedules one run using the existing unofficial
Garmin Connect session, then verifies steps/targets and the scheduled date.
Use the same private journal path on every retry. Unknown writes are not retried.
Changed prescriptions/edits require explicit reconciliation, not automatic updates.
No watch-delivery claim is made. Sync the device in Garmin Connect afterward.`);
  process.exit(0);
}

const email = argument("email")?.trim().toLowerCase();
const rawDate = argument("date");
const planId = argument("plan-id");
const apply = process.argv.includes("--apply");
const journalPath = argument("journal");
const secondary = process.argv.includes("--secondary");
const target = argument("target") ?? "pace";
if (!email || !rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate) || !["pace", "power"].includes(target)) {
  throw new Error("Provide --email, --date YYYY-MM-DD, and --target pace or power (see --help)");
}
const date = workoutCalendarDate(rawDate);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (apply && (!journalPath || !path.isAbsolute(journalPath))) {
  throw new Error("--apply requires an absolute --journal path in a private directory");
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 10 });
let lockFile: Awaited<ReturnType<typeof open>> | undefined;
let lockPath: string | undefined;
try {
  const [row] = await sql<Array<{
    id: string; user_id: string; plan_data: MarathonPlan | string;
  }>>`select p.id, p.user_id, p.plan_data from users u join plans p on p.user_id=u.id
      where u.email=${email} and p.id=${planId ?? sql`u.current_plan_id`} limit 1`;
  if (!row) throw new Error("Owned plan not found (select a current plan or pass --plan-id)");
  const plan: MarathonPlan = typeof row.plan_data === "string" ? JSON.parse(row.plan_data) : row.plan_data;
  const days = plan.weeks.flatMap((week) => week.days).filter((day) => day.date.slice(0, 10) === date);
  if (days.length !== 1) throw new Error("Plan must contain exactly one matching calendar day");
  const workout = selectPlannedRun(days[0], secondary);
  const key = digest([row.user_id, row.id, date, secondary, workout.id]).slice(0, 16);
  const payload = mapGarminWorkout(workout, {
    name: `EL ${date} ${workout.title.slice(0, 50)} [${key}]`,
    marker: `EnduroLab export ${key}`, target: target as "pace" | "power",
  });
  const fingerprint = digest({ payload, date });
  payload.description = `${payload.description}\nSHA256 ${fingerprint}`;
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", planId: row.id,
    date, slot: secondary ? "secondary" : "primary", sourceWorkoutId: workout.id,
    totalDistanceMiles: workout.totalDistance, target, fingerprint, payload }, null, 2));
  if (apply && journalPath) {
    const parent = path.dirname(journalPath);
    const parentStat = await stat(parent);
    if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0) {
      throw new Error("Journal parent must be a private directory (mode 0700)");
    }
    lockPath = `${journalPath}.lock`;
    lockFile = await open(lockPath, "wx", 0o600);
    const [locked] = await sql`select pg_try_advisory_lock(hashtext(${`garmin-export:${row.user_id}`})) as ok`;
    if (!locked.ok) throw new Error("Another Garmin export is active for this runner");
    const [connection] = await sql<Array<{ encrypted_tokens: string; status: string }>>`
      select encrypted_tokens, status from garmin_connections where user_id=${row.user_id} limit 1`;
    if (!connection || connection.status !== "connected") throw new Error("Reconnect Garmin before exporting");
    const auth = decryptGarminTokens<{ kind: string; session: PersistedSession }>(connection.encrypted_tokens);
    if (auth.kind !== "session") throw new Error("Complete Garmin MFA before exporting");
    if (!auth.session.oauth2Token.expires_at || auth.session.oauth2Token.expires_at <= Date.now() / 1000) {
      throw new Error("Garmin session is expired; refresh through normal sync before exporting");
    }
    const client = createFromSession(auth.session) as unknown as {
      httpClient: WorkoutTransport & {
        client: { defaults: { timeout: number }; interceptors: { response: { clear(): void } } };
      };
    };
    // Do not let the library refresh/replay a POST or leak token-bearing errors.
    client.httpClient.client.defaults.timeout = 30_000;
    client.httpClient.client.interceptors.response.clear();
    const result = await publishGarminWorkout(client.httpClient, {
      async read(): Promise<ExportCheckpoint | null> {
        try {
          const file = await open(journalPath, "r");
          try {
            const info = await file.stat();
            if ((info.mode & 0o077) !== 0) throw new Error("Journal must be private");
            const value = JSON.parse(await file.readFile("utf8")) as ExportCheckpoint;
            if (!value || typeof value.fingerprint !== "string" ||
                !["creating", "created", "scheduling", "scheduled"].includes(value.phase) ||
                (value.workoutId !== undefined && (!Number.isSafeInteger(value.workoutId) || value.workoutId <= 0))) {
              throw new Error("Invalid export journal; reconcile before retrying");
            }
            return value;
          } finally { await file.close(); }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
      async save(checkpoint): Promise<void> {
        const temporary = `${journalPath}.tmp`;
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(JSON.stringify(checkpoint)); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, journalPath);
        const directory = await open(parent, "r");
        try { await directory.sync(); } finally { await directory.close(); }
      },
    }, payload, date, fingerprint);
    console.log(JSON.stringify({ ...result, url: `https://connect.garmin.com/modern/workout/${result.workoutId}` }));
  }
} catch (error) {
  // Provider errors can include authorization headers/config; never print them.
  const candidate = error as { response?: { status?: number }; isAxiosError?: boolean };
  console.error(candidate.response || candidate.isAxiosError
    ? `Garmin request failed (HTTP ${candidate.response?.status ?? "unknown"}); inspect the journal before retrying`
    : error instanceof Error ? error.message : "Workout export failed");
  process.exitCode = 1;
} finally {
  if (lockFile) { await lockFile.close(); await unlink(lockPath!); }
  await sql.end();
}
