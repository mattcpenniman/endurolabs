/** Export/update a single owned, saved planned run using Garmin Connect. */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createFromSession } from "garmin-connect-client";
import type { PersistedSession } from "garmin-connect-client";
import { getCurrentUser } from "@/lib/auth";
import { conn } from "@/lib/db/client";
import { decryptGarminTokens } from "@/lib/garmin/crypto";
import { mapGarminWorkout, selectPlannedRun, workoutCalendarDate } from "@/lib/garmin/workout-export";
import { syncGarminWorkout } from "@/lib/garmin/workout-sync";
import type { WorkoutSyncState, WorkoutSyncTransport } from "@/lib/garmin/workout-sync";
import type { MarathonPlan } from "@/lib/training/models";

export const runtime = "nodejs";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  // Same-origin browser writes only; native clients without Origin remain authenticated.
  const origin = request.headers.get("origin");
  const appOrigin = new URL(process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin).origin;
  if (origin && origin !== appOrigin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "Save this plan before syncing" }, { status: 400 });
  }
  let body: { workoutId?: string; date?: string; expectedWorkout?: unknown; target?: "pace" | "power" };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body || typeof body.workoutId !== "string" || !body.workoutId || body.workoutId.length > 255 ||
      typeof body.date !== "string" || ![undefined, "pace", "power"].includes(body.target)) {
    return NextResponse.json({ error: "Select a saved running workout and pace or power target" }, { status: 400 });
  }
  const sql = await conn.reserve();
  let locked = false;
  try {
    const [lock] = await sql`select pg_try_advisory_lock(hashtext(${`garmin-export:${user.id}`})) as ok`;
    locked = lock.ok === true;
    if (!locked) return NextResponse.json({ error: "Another workout sync is active. Try again shortly." }, { status: 409 });
    const [row] = await sql<Array<{ plan_data: MarathonPlan | string }>>`
      select plan_data from plans where id=${id} and user_id=${user.id}`;
    if (!row) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    const plan: MarathonPlan = typeof row.plan_data === "string" ? JSON.parse(row.plan_data) : row.plan_data;
    const matches = plan.weeks.flatMap((week) => week.days.flatMap((day) =>
      ([false, true] as const).filter((secondary) =>
        (secondary ? day.secondaryWorkout : day.workout)?.id === body.workoutId
      ).map((secondary) => ({ day, secondary }))));
    if (matches.length !== 1) return NextResponse.json({ error: "Saved workout not found or ambiguous. Reload the plan." }, { status: 409 });
    const { day, secondary } = matches[0];
    const date = workoutCalendarDate(day.date);
    const workout = selectPlannedRun(day, secondary);
    if (date !== body.date || !isDeepStrictEqual(workout, body.expectedWorkout)) {
      return NextResponse.json({ error: "Plan has unsaved or newer changes. Save and reload before syncing." }, { status: 409 });
    }
    const [existing] = await sql<Array<{ state: WorkoutSyncState }>>`
      select state from garmin_workout_exports where user_id=${user.id} and plan_id=${id} and source_workout_id=${workout.id}`;
    let state = existing?.state ?? {};
    // Retain the CLI's initial deterministic identity, adopting verified CLI exports.
    const key = state.confirmed?.payload.description.split("\n")[0].replace("EnduroLab export ", "") ??
      digest([user.id, id, date, secondary, workout.id]).slice(0, 16);
    const payload = mapGarminWorkout(workout, {
      name: `EL ${date} ${workout.title.slice(0, 50)} [${key}]`,
      marker: `EnduroLab export ${key}`, target: body.target ?? "pace",
    });
    const fingerprint = digest({ payload, date });
    payload.description += `\nSHA256 ${fingerprint}`;
    const [connection] = await sql<Array<{ encrypted_tokens: string; status: string }>>`
      select encrypted_tokens, status from garmin_connections where user_id=${user.id}`;
    if (!connection || connection.status !== "connected") {
      return NextResponse.json({ error: "Connect Garmin in Profile before syncing workouts." }, { status: 409 });
    }
    const auth = decryptGarminTokens<{ kind: string; session: PersistedSession }>(connection.encrypted_tokens);
    if (auth.kind !== "session" || !auth.session.oauth2Token.expires_at || auth.session.oauth2Token.expires_at <= Date.now() / 1000) {
      return NextResponse.json({ error: "Refresh or reconnect Garmin in Profile, then sync this workout again." }, { status: 409 });
    }
    const client = createFromSession(auth.session) as unknown as {
      httpClient: WorkoutSyncTransport & {
        client: { defaults: { timeout: number }; interceptors: { response: { clear(): void } } };
      };
    };
    client.httpClient.client.defaults.timeout = 30_000;
    client.httpClient.client.interceptors.response.clear(); // Never replay a write after token refresh.
    const result = await syncGarminWorkout(client.httpClient, {
      read: async () => state,
      async save(next): Promise<void> {
        // Autocommit each checkpoint BEFORE dispatch; rolling back would lose uncertain writes.
        await sql`insert into garmin_workout_exports (user_id, plan_id, source_workout_id, state)
          values (${user.id}, ${id}, ${workout.id}, ${sql.json(JSON.parse(JSON.stringify(next)))})
          on conflict (user_id, plan_id, source_workout_id) do update set state=excluded.state, updated_at=now()`;
        state = next;
      },
    }, { payload, date, fingerprint });
    return NextResponse.json({ ...result, url: `https://connect.garmin.com/modern/workout/${result.workoutId}` },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Provider errors contain tokens/config: never log or serialize them.
    const provider = error as { response?: unknown; isAxiosError?: boolean };
    const message = provider.response || provider.isAxiosError
      ? "Garmin request failed. Sync the same saved version again to reconcile; unresolved writes will not be repeated."
      : error instanceof Error ? error.message : "Workout sync failed";
    // Database/internal errors must not leak query values or connection details.
    const safe = /^(Garmin |A previous sync |Previous |Old Garmin |Invalid Garmin |Ambiguous Garmin |Workout library |Workout date |Multiple matching |Journal and remote |Prescription changed|Selected entry |Not a running |Non-running segment |Segment has |Repetitions must |Recovery seconds must |Ambiguous aggregate |Export exceeds |Distance must |Duration must |Estimated duration must |pace must |power must )/.test(message);
    return NextResponse.json({ error: safe ? message : "Workout sync unavailable. Check the server configuration and database migration." }, { status: 409 });
  } finally {
    try { if (locked) await sql`select pg_advisory_unlock(hashtext(${`garmin-export:${user.id}`}))`; }
    finally { sql.release(); }
  }
}
