# Single-run Garmin export CLI

For the plan-page sync controls and in-place updates/rescheduling, see
[Planned-workout Garmin sync](garmin-workout-sync.md). The CLI below remains a
single-run create/verify tool with its own journal.

`npm run garmin:export-workout` previews or publishes one stored planned run (or
an explicitly selected standalone test workout)
through the athlete's **existing Garmin Connect session**. This is an unofficial
Garmin Connect workout-service integration, not Garmin's registered Training API.
The official Training API remains the recommended longer-term integration path.

## Usage

```bash
# Read-only preview: current plan, primary run. No Garmin requests.
npm run garmin:export-workout -- --email runner@example.com --date 2027-02-16

# Select a particular owned plan or the second run on a double day.
npm run garmin:export-workout -- --email runner@example.com --plan-id UUID --date 2027-02-16 --secondary

# After inspecting the preview, publish and schedule this one run.
# Create a private directory for journals first, and retain it for future reruns.
mkdir -m 700 ./garmin-export-journals
npm run garmin:export-workout -- --email runner@example.com --date 2027-02-16 \
  --apply --journal "$PWD/garmin-export-journals/2027-02-16-primary.json"
```

Requires Node 22, the declared npm dependencies, `DATABASE_URL`, and (for apply)
the existing `GARMIN_TOKEN_ENCRYPTION_KEY`. `.env` is loaded when present. Never
replace the encryption key to make an existing session decrypt. The CLI requires
a connected, unexpired session; refresh/reconnect through the normal application
if needed. It does not refresh tokens, store credentials, or replay failed POSTs.

The script uses `vite-node --config vitest.config.ts` like the existing planner
CLIs. A production-only container can run a bundled ESM copy with `postgres` and
`garmin-connect-client` external, without installing developer dependencies or
redeploying the application. The bundler must resolve the `server-only` marker
to an empty module, just as the existing CLI config does. Only run such a bundle
in a trusted administrative environment containing the original encryption key.

## Mapping and scope

### Standalone 100 m test

Use `--test-intervals N` (1–24) to build a standalone workout instead of selecting
a saved run. It contains 1 mile easy, then N pairs of 100 m at marathon pace and
100 m easy, including the final recovery. Easy uses the midpoint of the selected
owned plan's easy range; marathon uses its marathon anchor. Pace targets only;
`--secondary` and `--target power` are rejected. The date may fall outside the
plan calendar. No saved plan or run is changed. Preview first, then reuse the
same private journal for apply and any reconciliation:

```bash
npm run garmin:export-workout -- --email runner@example.com --date 2026-10-25 --test-intervals 5
# Add --apply --journal /private/directory/oct25-test.json to publish and schedule.
```

The standalone test has a separate source identity from saved workouts. Changing
the count or pace anchors after publishing is a changed prescription and stops
the create-only publisher; it does not silently create a replacement.

VEC-1090 live acceptance on October 25, 2026 created and scheduled this five-pair
test for that date. Garmin readback verified all 11 distance steps and pace
targets (2,609.344 m total). The saved source plan was not edited. This verifies
Garmin Connect, not watch delivery; sync and inspect the device separately.

- By default uses the saved workout, not a regenerated plan. Email selects only the
  designated current plan; an explicit plan ID must belong to that email.
- Primary and secondary runs have separate identities; only one is sent per
  invocation. The plan calendar date is preserved without timezone shifting.
- Ordered warm-up, work, recovery, and cool-down steps preserve miles (converted
  to meters), minutes (converted to seconds), and prescribed pace anchors
  (converted from min/mile to m/s). Target bounds are both set to the exact
  prescribed anchor; no unrequested target-band widening is applied.
- `--target power` explicitly selects prescribed watts instead. Missing power
  targets stop the export rather than substituting pace or modeled sensor data.
- Repeated work expands to executable steps with recovery only between reps.
  Known aggregate recovery rows from the planner are consumed, not duplicated.
  Ambiguous aggregate recovery or simultaneous distance/duration rules stop the
  export. This initial version supports at most 50 executable steps.
- Rest, strength, and cross-training are rejected. Races require selecting that
  particular date. RPE is retained in notes, not converted to invented HR targets.

## Duplicate handling and uncertain writes

Keep the **same private journal path for the same source workout** on every run.
The journal checkpoints create/schedule intent before dispatch and fsyncs each
state. A private directory and exclusive lock file protect local concurrency;
a database advisory lock serializes exports per athlete. A crash can leave the
lock file behind: inspect the original process and journal before removing it.

The remote name contains a deterministic identity derived from athlete, plan,
date, slot, and source workout ID. Description includes a prescription hash.
The publisher scans up to 2,000 library entries before creating anything, reuses
one exact match, verifies every executable duration/distance/pace or power target,
then checks the scheduled date. An incomplete scan or multiple matches stops.
Changed local or remote prescriptions stop rather than overwriting anything.

There are no automatic create/schedule retries. An uncertain write is reconciled
only when remote readback positively establishes the expected workout or date.
If it cannot, retain the original journal and investigate; do not use a new
journal, rename the export, delete a remote item, or resubmit to bypass that
state. This CLI does not implement edit, reschedule, cancellation, or bulk sync.

Success means the workout's steps and calendar date were read back from Garmin
Connect. It does not prove delivery to a watch: sync the compatible device and
inspect its workout before claiming on-device acceptance.

## Contract references

The unofficial endpoint/payload shape was inspected in the public
[python-garminconnect workout API](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/api/workouts.py)
and [typed workout model](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/workout.py)
on 2026-10-25. The account's read-only
`GET https://connectapi.garmin.com/workout-service/workout/types` confirmed the
running sport, step, condition, and pace/power target IDs before testing writes.
These web endpoints may change independently of EnduroLab.

## Initial live acceptance (2026-10-25)

The owner-authorized test used the current Newport Marathon 2027 plan's primary
February 16, 2027 workout: 14 miles of warm-up, marathon/threshold alternations,
and cool-down. All six distance steps and exact pace targets were read back from
Garmin Connect, and its calendar date was confirmed as February 16. The separate
secondary easy run was not published. No saved plan was changed.

The first invocation created and scheduled the workout but reported verification
failure because the schedule response nests `workoutId` under `workout`. After
inspecting the response read-only, the verifier and its regression fixture were
corrected. Reconciliation with the original journal completed successfully and
reused the existing workout and schedule without repeating either POST. The
original failed receipt and subsequent successful receipt are retained privately
in the issue session's artifacts. On-device sync/acceptance was not observed.
