# Planned-workout Garmin sync

On the plan page, expand a week and use **Sync to Garmin** beneath a running
workout. Primary and secondary runs have separate controls. Choose pace targets
(default) or explicit prescribed power targets. Missing power anchors stop the
request rather than substituting another target. Connect Garmin in Profile first.

Each run loads its saved **Synced**, **Changed since sync**, **Not synced**,
**Needs reconciliation**, or **Cannot sync** status for the selected target mode.
The last verified time and Garmin link persist after reloading; a confirmed,
unchanged run offers **Resync to Garmin**. Use **Refresh status** to reload the
saved record. Unsaved workout edits are labeled **Save changes before syncing**.
These labels compare the saved export with the plan; they do not poll Garmin
or confirm watch delivery. Status refreshes after a sync and on window focus.

Both single-run and full-plan sync include a **180–190 steps/minute cadence goal**
as Garmin's secondary target on every executable running step, including warm-up,
cool-down and between-rep running recovery (excluding the walk/jog full-recovery
steps between strides described below). The primary pace/power target is preserved.
This is total running steps/minute, not single-leg cadence. Readback must confirm
both cadence bounds before sync is successful. Previously confirmed exports show
as changed and update in place on explicit resync. Unresolved older exports first
reconcile their exact original prescription; the following sync adds cadence.

### Strides

Saved text-only **Easy + Strides** and race-week shakeout prescriptions export
executable strides after the original easy-running step. Base instructions of
6–8 × 20–30 seconds use **6 × 20 seconds**; shakeout instructions of 4–6 × 20 seconds
use **4 × 20 seconds** (the lower end of each range). Between strides, walk/jog
until fully recovered and **press Lap** to start the next stride. There is no
extra recovery step after the final stride. The original easy distance and target
stay intact; the strides add time and distance beyond that easy-running block.
The duration estimate includes timed strides but excludes open-ended recovery.

Strides are relaxed, fast and smooth, not sprints. They have no invented pace or
power target, including in power export mode; running strides retain the cadence
goal, while walk/jog recovery has no cadence goal. Already structured timed
strides use their saved segments instead. Unrecognized text-only stride
prescriptions are rejected rather than silently exported as an ordinary easy run.

Previously exported text-only workouts show **Changed since sync**. Explicitly
sync them again (or retry the full-plan sync) to update the same Garmin workout
IDs. Saved plans do not need regeneration. Unknown older writes first reconcile
their original text-only payload before the next sync adds stride steps. Source
tests cover mapping and legacy reconciliation; live Garmin/watch acceptance of
these stride steps has not been performed.

This uses the existing **unofficial Garmin Connect** connection, not the official
Training API. The run-level button sends one saved workout per click. Success means executable
steps and the calendar date were read back from Garmin Connect; sync your watch
in Garmin Connect afterward. Watch delivery has not been verified by this feature.

### Interval recoveries

Cruise and VO2 intervals export exactly one timed recovery between repetitions,
with none after the final rep. The planner's separate **Recoveries** row is an
aggregate, not an extra executable step. Its explicit duration takes precedence
over its quarter-mile-rounded distance estimate. Older saved plans without that
duration are also supported when the distance matches the planner's rounded
estimate (including zero for short recoveries), or the existing time-consistency
check. Conflicting durations or unrecognized aggregate rows still block sync.
Saved plans do not need regeneration for this normalization.

## Editing

Use the existing run editor to change its title, distance, duration, or day within
the displayed week. Save the plan change before syncing again. A distance edit
scales all steps and recoveries; a duration edit converts distance steps into
timed steps and scales them to the requested duration. Repeat counts and exact
pace/power targets stay fixed. Change distance or duration one at a time: the
other total is adjusted automatically. Timed resizing requires a duration or
pace on every segment. The workout breakdown shows the executable prescription.

Sync again after saving to update the **same Garmin workout ID**, rather than
creating a second template. Date changes move the existing calendar schedule.
Other plan edits do not automatically contact Garmin; explicit sync is required.
Changes to already exported workouts via a different plan copy are separate
exports. Cancellation/deletion is not provided.

## Full-plan sync and status

Open **Plan → Settings → Sync full plan to Garmin**. Choose pace or prescribed
power targets. Sync exports every saved running workout (including past dates
and doubles), skipping rest, strength, and cross-training sessions. On double
days the main run is sent before the secondary run; names include **AM / first**
and **PM / second**. These are order labels, not scheduled start times: Garmin's
calendar/watch may choose its own display order. Existing workout IDs remain stable.

The card shows per-run **Synced**, **Changed since sync**, **Not synced**,
**Needs reconciliation**, or **Cannot sync**, plus the last verified timestamp
and Garmin link. Status is read from durable exports and compared against the
current saved prescription, date, and selected target mode. It survives reloads;
it does not poll Garmin for external edits. Refresh status to check again.

Keep the Settings tab open during a batch. Runs are sent sequentially, and each
is verified before the next starts. Invalid prescriptions are checked before
any upload. A failure stops the batch; successful earlier runs remain saved.
Retry sends only changed/unconfirmed runs. When everything matches, **Resync
full plan** explicitly reads back/verifies every run again. **Stop after current
workout** preserves the in-flight checkpoint and stops subsequent runs. Changing
the displayed plan also stops subsequent uploads. Unsaved/newer server edits are
rejected by the per-run endpoint. Unknown writes still require the exact saved
version and readback reconciliation; no blind retries are introduced.

Exports whose source IDs disappeared (for example after regeneration) are counted
separately. Their remote schedules remain and must be removed in Garmin Connect;
the product does not silently delete previous Garmin calendar entries.

## Deployment

### Diagnosing unavailable sync

The generic unavailable message is not proof that a migration is missing. Check
the deployed server's database and original encryption-key configuration. The
route logs a fixed failure stage, sanitized SQLSTATE, allowlisted exception type
and runtime code, and an application call-site location. It admits only narrow
structural JavaScript messages such as an undefined-property access; arbitrary
error text, queries and credentials are excluded. Provider reads/creates/updates
and checkpoint saves have separate stages. SQLSTATE `42P01` identifies a missing
relation and returns
the workout migration path; credential-decryption failures identify the existing
encryption key separately. Never generate a replacement key for stored sessions.

VEC-1115 identified the October 25 checkpoint failure: Drizzle initializes the
shared app SQL client's JSON serializers as identity functions. Passing an object
through `sql.json()` on that client raises `ERR_INVALID_ARG_TYPE` while encoding
the checkpoint, before the Garmin upload. `saveWorkoutSyncState` therefore sends
`JSON.stringify(state)::jsonb` through that **Drizzle-initialized client**, with a
PostgreSQL regression that asserts the stored value is an object and upserts one
row. Standalone scripts using an ordinary postgres.js client must continue using
`sql.json(object)`; serializing a string through its default JSON serializer would
double-encode it. These are different client configurations.

Apply `scripts/add-garmin-workout-sync.sql` (or `npm run db:push`) before deploying
the application. It creates `garmin_workout_exports`, keyed by athlete, plan, and
source workout ID, with durable JSONB write-ahead state. Existing encrypted
connections use the original `GARMIN_TOKEN_ENCRYPTION_KEY` and `DATABASE_URL`.
No new Garmin credentials are needed. An expired session asks the runner to
refresh/reconnect in Profile; the workout endpoint disables automatic write replay.

## API and reconciliation

`POST /api/plan/[id]/garmin-workout` takes:

```json
{
  "workoutId": "easy-w1-0",
  "date": "2027-02-16",
  "expectedWorkout": { "...": "the complete saved Workout object" },
  "target": "pace"
}
```

`GET /api/plan/[id]/garmin-workout?target=pace` (or `power`) returns owner-only,
uncached saved-plan sync status and saved workout snapshots for the batch.
Both controls use the same POST and durable export table; no new migration is
required beyond the existing workout-sync migration. Confirmed state now records
`verifiedAt`; older confirmed rows fall back to their last database update when
there is no unresolved operation. Same-origin writes accept the configured public
URL and the effective public proxy host, so TLS termination and public host
aliases do not produce `Invalid request origin`. The reverse proxy must overwrite
forwarded host/protocol headers; foreign origins remain rejected.

For the deployed Apache setup, `APP_URL` may use the bare domain while Apache
redirects the browser to `www`. `ProxyPreserveHost On` retains that public host,
but Apache does not currently send `X-Forwarded-Proto`. Next.js therefore fills
it with `http` from its internal connection, even for a public HTTPS request.
The origin check also accepts HTTPS on that exact public host/port in this case;
it does not accept another host, another port, or downgrade an HTTPS proxy origin
to HTTP. Changing only `APP_URL` does not address all public aliases. Regression
tests cover the bare-domain configuration, `www` Origin/Host, and Next's generated
`x-forwarded-proto: http` / internal `x-forwarded-port: 3001` together.

Authentication and plan ownership are required. The server selects the workout
from its saved plan; `expectedWorkout` and `date` detect stale or unsaved frontend
changes, and cannot override the saved prescription. Success returns `workoutId`,
`date`, `verified: true`, and a Garmin Connect `url`. Errors are shown inline;
401 requires sign-in, 404 means the plan is not owned/found, and 409 describes a
connection, saved-version, concurrency, prescription, or reconciliation conflict.

The endpoint shares the CLI's per-athlete advisory lock. Each checkpoint commits
**before** a provider write, outside a transaction that could roll it back. Initial
publishing uses the bounded library scan and verifier from the CLI and can adopt
an exact existing CLI export on the same date/slot/prescription. Once confirmed,
the stored Garmin ID remains stable across day, title, distance and duration edits.
Remote edits are compared against the last confirmed prescription before PUT;
unexpected remote changes stop rather than being overwritten. Rescheduling GETs
the existing schedule entry, PUTs its new `calendarDate`, and verifies both the
new date and absence on the old date. No delete/recreate is used.

On a network failure, retry **the same saved version** to reconcile by readback.
Writes with unknown outcomes are never automatically replayed. If readback cannot
confirm the previous write, the endpoint stops and asks for reconciliation in
Garmin. Further edits are blocked while that operation is unresolved. Preserve
the original database state and investigate the exact Garmin workout/schedule;
do not clear the row, rename the export, or create another plan to bypass it.
The CLI keeps its own private journal and does not implement these updates; use
the product UI for subsequent edits after adoption.

Contracts were inspected in the public
[python-garminconnect workout API](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/api/workouts.py)
on 2026-10-25: workout replacement uses `PUT /workout-service/workout/{id}`;
calendar moves use `GET` and `PUT /workout-service/schedule/{scheduleId}` with the
existing entry and new `calendarDate`. Automated tests cover in-place updates,
moves, positive timeout reconciliation, blocked uncertain writes, and external
edit conflicts. Live update/reschedule and watch acceptance require separate
authorized acceptance; the earlier CLI create/schedule test does not prove them.

The public typed [workout model](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/workout.py)
defines cadence target ID 3 (`cadence`) in steps/minute and supports
`secondaryTargetType`/`secondaryTargetValueOne`/`secondaryTargetValueTwo`.
On October 25, 2026, VEC-1112 updated the existing standalone five-pair test
workout **1740219430** in place. Garmin Connect readback confirmed 180–190 spm
on all 11 steps, unchanged pace targets/distances and the same calendar date.
Watch delivery was not observed. This live update preserved the historical CLI
description/hash as provenance; its original create-only journal is historical
and must not be used to replay the pre-cadence prescription.
