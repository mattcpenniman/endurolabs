# Garmin running dynamics persistence (VEC-1141)

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
Production split averages, coverage policy and dynamics UI are VEC-1139.

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
