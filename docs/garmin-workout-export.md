# Sending planned runs to Garmin

Feasibility investigation for VEC-1076. Sources checked 2026-10-25.

## Answer

**Yes. Garmin's official Training API publishes workouts and training plans to
the Garmin Connect calendar.** After the runner consents, Garmin Connect handles
delivery to compatible devices when they sync. This is the appropriate API for
EnduroLab's planned runs, rather than the Activity API used for recorded runs.

The follow-on VEC-1077 [single-run export CLI](garmin-workout-cli.md) now sends
selected workouts through the existing **unofficial Garmin Connect session**.
Its February 16, 2027 test verified a six-step, 14-mile workout and calendar date
in Garmin Connect. Official Training API authorization and watch-delivery
acceptance remain separate future steps. This document describes that official
integration path; the CLI guide describes the implemented immediate path.

## Access and prerequisites

- Request Garmin Connect Developer Program **Starter Access** for EnduroLab.
  Garmin's current overview includes the Training API in both Starter and
  Enterprise; Enterprise is not listed as mandatory for basic workout publishing.
- Garmin's FAQ says portal access follows approval and all Developer Program
  APIs use OAuth 2.0. Implement the app registration and per-runner consent using
  the portal's actual authorization contract. Existing Garmin username/password
  sessions are not evidence of official Training API authorization.
- The public pages establish the capability, but do not specify the endpoint
  schemas, scopes, workout limits, scheduling/update/delete semantics, rate
  limits, or precise running-target support. Retrieve those from the approved
  portal before implementing an adapter. Confirm Starter capacity and any
  applicable commercial terms there; do not assume unlimited or free access.
- Garmin's Personal offering is advertised for pulling one's own activity,
  health, and women's health data. The public overview does not advertise
  Training API publishing for Personal keys, so a Personal key is not the
  established route for this feature.
- A compatible Garmin device and a Garmin Connect sync are required for the
  on-watch experience. An accepted API request must not be labeled "on watch"
  without evidence of that later delivery.

## What exists in EnduroLab

| Area | Current state |
| --- | --- |
| Garmin authentication | `src/lib/garmin/client.ts` restores encrypted sessions through `garmin-connect-client`, including refresh and optional credential-based re-login. This is distinct from a registered Developer Program integration. |
| Client capability | The installed `garmin-connect-client` 1.2.0 `GarminConnectClient` interface exposes activity/golf/sleep reads and session retrieval, with no workout create or schedule methods. Its activity `workoutId` field is not an upload method. |
| Planned workout model | `src/lib/training/models.ts` already has workout IDs, titles, descriptions, ordered segments, distance, duration, pace, power, repetitions, and recovery seconds. `DailyPlan` provides a date and optional secondary workout for doubles. |
| Calendar export | `src/lib/training/calendar-export.ts` generates `.ics` calendar events. Those are not executable Garmin structured workouts. |

VEC-1077 extends the existing client's authenticated transport to Garmin Connect
web workout endpoints. Its narrow contract was checked against public client
models, the account's workout type dictionaries, and one live workout/calendar
readback; it is not an official Training API contract. Recommend the supported
Training API for the longer-term integration.

## Proposed mapping

These are source-model requirements, **not a claim about Garmin's private JSON
schema**. Confirm the target representation against portal documentation.

| EnduroLab input | Export behavior |
| --- | --- |
| Running `Workout` | One structured running workout with title and coaching notes; preserve the segment order, including warm-up/cool-down where present. |
| `DailyPlan.date` | Schedule using the plan's calendar date, without a UTC conversion that moves it to another day. |
| `secondaryWorkout` | A separate workout and export identity on the same date; do not merge double runs. |
| Segment `distance` | Miles to meters: multiply by 1609.344. |
| Segment `duration` | Minutes to seconds: multiply by 60. Choose the prescribed termination rule; do not use `estimatedDuration` to override a distance prescription. |
| Segment `pace` | Minutes/mile to speed if required by the schema: `1609.344 / (pace * 60)` meters/second. A faster pace is a larger speed, so normalize target bounds after conversion. |
| `repetitions` and `restBetween` | Preserve repeated work and between-rep recovery; inspect `workout-library.ts` semantics before expansion so neither work distance nor the final recovery is counted twice. |
| Segment `power` | Preserve prescribed watts only if supported by the API and selected running device. Clearly show unsupported targets in preview rather than silently substituting pace or modeled sensor data. |
| Segment `effort` | Preserve RPE/coaching text; do not invent a numeric HR target from a text descriptor. |
| Rest, strength, cross-training | Skip for the first running-only release, and report why. Treat race-day export as an explicit selection rather than automatically publishing every calendar entry. |

If a source segment has ambiguous duration/distance semantics or an unsupported
target, return an actionable preview warning and require resolution before
sending it. HR targets could be a later extension using the plan's explicit
zones; the current segment model has no explicit HR target field.

In particular, `createThresholdIntervals` already stores a separate aggregate
recovery segment as well as `restBetween` on the repeated work segment. Exporting
both literally would duplicate recovery. Normalize that representation into
interleaved work/recovery steps with only `repetitions - 1` recoveries, and consume
the aggregate recovery segment rather than appending it again. Audit the other
interval builders for the same pattern before generalizing the mapper.

## Recommended first release

1. **Establish access:** register EnduroLab, obtain the Training API contract,
   and add official per-runner authorization/token persistence separately from
   the existing inbound-sync session format. Handle disconnect/revocation.
2. **Build a pure mapper and preview:** selected upcoming runs -> validated
   workout drafts. Show date, distance/time, steps, targets, skips, and warnings.
   Keep this mapper independent of provider HTTP and database code.
3. **Add an authenticated "Send to Garmin" action:** enforce plan ownership on
   the server; start with an explicit selection or short date window. Persist
   export records keyed by runner, plan, source workout identity, and provider,
   with payload fingerprint, remote workout/schedule identifiers, and status.
   Repeated clicks or retries must not create duplicate workouts. Reconcile
   uncertain create responses before retrying; use documented provider lookup
   or idempotency support rather than assuming it exists.
4. **Handle edits:** use the stored remote identity for documented update or
   replacement behavior. Rescheduling/cancellation must affect only EnduroLab's
   own exports. Keep accepted, scheduled, failed, and unknown states distinct;
   do not claim watch delivery from API acceptance. Define behavior for edits
   made in Garmin before enabling automatic resync.
5. **Validate before broadening:** pure tests for unit conversion, repeat/recovery
   boundaries, mixed segments, missing/invalid targets, dates, rest days, and
   doubles; mocked adapter tests for authorization, duplicates, partial failures,
   timeouts, and edits. Then perform an explicitly authorized end-to-end test
   with a runner account and compatible watch: publish, inspect Garmin Connect's
   steps/date, sync, and verify the on-device workout. Exercise update and
   cancellation against the documented contract too.

## Decision and remaining unknowns

The official Training API remains the recommended longer-term integration path.
VEC-1077 supplies a pure mapper, unofficial adapter, private file journals and
an administrative CLI for single-run exports. A registered provider integration,
product UI, and bulk/edit/cancellation workflows remain future work.

For the official integration, the next action is for the EnduroLab owner to
request Starter Access and retrieve the portal contract. No approved app
credentials or portal schema were available in the feasibility investigation.
The subsequent unofficial live upload is documented in the CLI guide;
on-device delivery was not observed.

## Sources

Official Garmin pages retrieved on 2026-10-25:

- [Training API features](https://developer.garmin.com/gc-developer-program/enterprise/training-api/): publishing workouts/training plans to the calendar, user consent, and Garmin Connect device sync.
- [Developer Program overview](https://developer.garmin.com/gc-developer-program/overview/): Starter/Enterprise API inclusion and Personal data-access scope.
- [Developer Program FAQ](https://developer.garmin.com/gc-developer-program/enterprise/program-faq/): approval/portal documentation and OAuth 2.0.
- [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/): Personal key/token flow; not proof of workout publishing.
- [Request Starter Access](https://www.garmin.com/en-US/forms/StarterGarminConnectDeveloperAccess/).

Repository evidence: `src/lib/garmin/client.ts`, `src/lib/training/models.ts`,
`src/lib/training/workout-library.ts`, `src/lib/training/calendar-export.ts`,
`package-lock.json`, and the installed package's `dist/types.d.ts`
(`GarminConnectClient` interface). The original feasibility investigation made no
Garmin writes; the owner-authorized follow-on CLI test did, as documented above.
