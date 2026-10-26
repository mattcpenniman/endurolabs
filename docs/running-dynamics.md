# Garmin running dynamics persistence and display (VEC-1141 / VEC-1139)

The real per-sample sensor trace is primary. Summary values are supplemental;
they never fill missing samples. No raw Garmin payloads are stored.

## Storage contract

Both `run_activities` and `activity_samples` have these nullable PostgreSQL
`double precision` fields (camelCase in application models/API samples):

| Column | Application field | Units | Accepted sensor range |
| --- | --- | --- | --- |
| `vertical_oscillation_cm` | `verticalOscillationCm` | centimeters | >0 to 50 |
| `vertical_ratio_percent` | `verticalRatioPercent` | percentage points | >0 to 100 |
| `ground_contact_time_ms` | `groundContactTimeMs` | milliseconds | >0 to 2000 |
| `ground_contact_balance_left_percent` | `groundContactBalanceLeftPercent` | LEFT percentage points | >0 to 100 |
| `stride_length_cm` | `strideLengthCm` | centimeters | >0 to 1000 |

These are broad ingestion plausibility bounds, **not** coaching targets. Zero,
negative, nonnumeric, nonfinite and above-range readings are unavailable (`null`),
independently per metric. Missing balance is never 0 or 50:50. RIGHT balance may
only be derived from a valid LEFT reading as `100 - left`. Percent values such
as 5.71 and 50.79 are already percentage points: no multiplication by 100.
Fractional centimeters/milliseconds are not rounded. No sensor/device identity
or universal form score is inferred.

## Provider mappings (DOC-368)

| List summary | `summaryDTO` | Detail descriptor |
| --- | --- | --- |
| `avgVerticalOscillation` | `verticalOscillation` | `directVerticalOscillation` |
| `avgVerticalRatio` | `verticalRatio` | `directVerticalRatio` |
| `avgGroundContactTime` | `groundContactTime` | `directGroundContactTime` |
| `avgGroundContactBalance` | `groundContactBalanceLeft` | `directGroundContactBalanceLeft` |
| `avgStrideLength` | `strideLength` | `directStrideLength` |

The confirmed list balance alias means LEFT, established by the explicit DTO
and detail names. Generic DTO `groundContactBalance` is not accepted. A present
list field takes precedence, even when null/invalid; absent list fields fall
back to the explicit DTO alias. `directVerticalSpeed` is unrelated and ignored.
Confirmed literal detail unit keys are `centimeter`/`ms`/`dimensionless`, factor 1
(from the original VEC-1136 probe transcript); the equivalent `cm` abbreviation
is accepted too. If supplied unit metadata
conflicts, the metric is null rather than guessed or silently rescaled. Absent
unit metadata uses the confirmed descriptor's native units.

`src/lib/garmin/running-dynamics.mjs` owns summary aliases/ranges;
`activity-detail.mjs` is the single pure detail mapper for app, foreground,
background jobs and `scripts/backfill-samples.mjs`. TypeScript consumers use its
typed wrapper/declarations. Standalone summary history imports use the same
summary dynamics mapper. Existing distance/HR/power conversion and the integer
`(activity_id, elapsed_seconds)` sample identity/timestamp behavior are retained.
The standalone sample script caps concurrency at 2. Lease acquisition, token
persistence/release and normal sync ownership retain their existing workflows.
This change does not make the old script a dynamics-only resumable backfill.

## Readback and downstream work

The owner and existing read-only share detail endpoints select these nullable
fields alongside elapsed time. Chart downsampling retains the selected sample's
values and per-metric nulls. The database retains the complete trace; downstream
split calculations must consume ordered full-resolution samples **before** chart
downsampling and report independent per-metric contributing duration. The
PostgreSQL ingestion test demonstrates fractional full-trace split consumption
and chart readback without replacing actual traces with summary averages.
### Detail API and display (VEC-1139)

The authenticated activity endpoint and existing run, race and plan token-scoped
detail endpoints deliberately expose the same `dynamics` report. Existing
ownership/token restrictions remain in place; shared Stats and splits are
read-only. The five nullable provider run averages remain in the activity
serializer and are labeled separately from trace-derived means. Disagreement
is not silently corrected: providers can use different filtering.

`src/lib/activities/running-dynamics.ts` consumes the ordered complete stored
trace before generic sample decimation. Each interval requires two valid moving
speeds (>0 and <=12 m/s), increasing elapsed time, and a gap <=30 seconds. Each
metric independently requires two in-range endpoints, never a summary fallback.
Values are linearly integrated over elapsed time, clipped at the exact existing
distance-split elapsed boundaries (including fractional seconds). Existing
speed-integrated, summary-distance-reconciled split boundaries are unchanged.
All four supported split lengths include their own dynamics window.

Each report/window includes recorded `durationSeconds`, `eligibleSeconds` and
per-metric `average`, `validSeconds` and `coverage` (fraction of eligible time).
No eligible time gives null coverage; eligible time with missing metrics gives
zero coverage and null average. Stops, long gaps and unrecorded leading/trailing
time are not valid metric duration. Thus 100% eligible coverage does not claim
100% recorded coverage; both contributing seconds and eligible time are shown.

The report also supplies at most 360 fixed elapsed-time weighted chart bins,
each with independent metric coverage and speed-integrated pace on the same
time axis. Bins aggregate every overlapping full-resolution interval; they are
not sampled rows or fabricated copies of summary values. The SVG leaves any
partially observed metric bin blank rather than bridging nulls or stops. This
conservative display can hide a brief valid portion of an incomplete bin; the
read-only expandable values table retains that bin's weighted mean and coverage.
Pace uses a separate labeled scale and excludes invalid/stationary/gap intervals.

The existing Stats tab headlines each available full-trace mean, labeled
`Full-trace average`, with independent coverage and a supplemental provider run
average. Missing provider summaries say `Not stored`: historical dynamics-only
backfills preserve summary fields, so absent summaries do not mean the trace is
unavailable. If a metric has no trace average, its stored provider average is
the headline, labeled `Provider run average`, with the trace marked unavailable
(or loading while detail is pending). Missing both remains unavailable, including
absent balance; no values are synthesized or persisted by this display choice.
The tab includes a selectable responsive SVG dynamics/pace chart. Stride uses meters
or feet with explicit units; oscillation stays cm, contact time ms, and ratio
percentage points. Balance explicitly labels left/right and derives right only
from valid left. Descriptive copy stresses pace, terrain and sensor variation;
no lower-is-better rule or form score is added. Route & splits includes all five
dynamics columns with independent valid seconds/coverage. The existing image
export includes the active Stats SVG; wider split tables retain scrolling on
screen and expand through the existing export sizing path. Switching activities
keys detail state to its URL so the previous trace cannot accompany a new run.

Tests: `dynamics-aggregation.test.ts`, `dynamics-api.test.ts`, and the existing
`run-score-card.test.tsx` cover full-trace aggregation, fractional split weights,
missing metrics/balance, gaps/stops, null/zero coverage, summary-only behavior,
units, all four serializers, activity switching and the PNG export pipeline.
The export test mocks the rasterizer/clipboard; real-device clipboard, sensor
and browser layout acceptance remains part of VEC-1138 rollout.

## Migration and verification

Apply `scripts/add-running-dynamics.sql` before deploying compatible app/worker
code. It only adds nullable columns with `IF NOT EXISTS`, in a transaction; no
existing data is rewritten. Existing rows read as null until a new authorized
detail fetch. Fresh development databases can use `npm run db:push`.

Use an isolated PostgreSQL 16 database (the version in `docker-compose.yml`),
bootstrap from `package-lock.json` with `npm ci` when dependencies are not already
verified, verify `npm ls --depth=0` and runtime imports, then:

```sh
DATABASE_URL="$TEST_DATABASE_URL" npm run db:push
TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test
npm run build
```

`running-dynamics-migration.integration.test.ts` migrates legacy tables in an
isolated schema and reruns the migration after fractional values exist.
`sample-ingestion.integration.test.ts` runs the real application upsert and
analytics path twice, checking stable IDs/timing/counts and unrelated values.
Without `TEST_DATABASE_URL`, PostgreSQL tests are skipped, not a passing DB check.

No production migration/deployment or historical refetch/backfill is authorized
by this implementation. VEC-1140 owns the preview-first resumable dynamics
backfill; VEC-1138 owns reviewed rollout and historical operations.
