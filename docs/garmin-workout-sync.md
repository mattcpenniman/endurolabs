# Planned-workout Garmin sync

On the plan page, expand a week and use **Sync to Garmin** beneath a running
workout. Primary and secondary runs have separate controls. Choose pace targets
(default) or explicit prescribed power targets. Missing power anchors stop the
request rather than substituting another target. Connect Garmin in Profile first.

This uses the existing **unofficial Garmin Connect** connection, not the official
Training API. It sends one saved workout per click. Success means executable
steps and the calendar date were read back from Garmin Connect; sync your watch
in Garmin Connect afterward. Watch delivery has not been verified by this feature.

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
exports. Cancellation/deletion and bulk sync are not provided.

## Deployment

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
