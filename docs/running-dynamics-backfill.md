# Historical running-dynamics detail backfill

VEC-1140 provides tooling only. VEC-1138 owns migration, deployment, pilot and
production execution. Existing summaries/raw payloads cannot reconstruct historic
dynamics: this command refetches full detail through the stored Garmin connection.

## Inventory first

```sh
npm run dynamics:backfill -- --email runner@example.com --since 2025-11-01 --through 2026-10-25 --limit 10
# Or select exactly one UUID instead of email:
npm run dynamics:backfill -- --user-id UUID --limit 10
```

Exactly one athlete selector is required. Dates are inclusive UTC calendar dates.
Limit defaults to 100, maximum 1000; unknown/malformed options fail closed. Set
`DATABASE_URL` through the established private environment (`.env` also loads).
The default is a **DB-only inventory**, enforced with PostgreSQL's read-only
transaction default. It never initializes Garmin auth, refreshes tokens, fetches
provider data, creates tables or updates checkpoints. It works before the new
checkpoint table exists, provided the VEC-1141 dynamics columns are present.
There is no hidden live-fetch preview mode.

Output reports scoped, eligible, selected, exhausted, attempted, requests,
succeeded, unavailable and failed counts. Eligible includes incomplete, failed,
interrupted and changed-row-count checkpoints; selected applies limit, retry
budget and cooldown. Attempted counts activities actually started in this run;
requests counts explicit detail GET attempts, including retries. Before/after
coverage is **nonnull sample counts per metric and total samples for the selected
scope**, not a single summary-field completion proxy. Counts from previous runs
are not presented as newly successful work. Eligible can exceed attempted after
cancellation, exhausted budgets, lock/auth failure or a bounded batch.

## Authorized apply (final-stage operations only)

During the separately approved rollout, apply `scripts/add-running-dynamics.sql`
and then additive/idempotent `scripts/add-dynamics-backfill.sql` before compatible
tooling. The same checkpoint definition is in the Drizzle schema. Preserve the
existing encryption key. Apply requires `GARMIN_TOKEN_ENCRYPTION_KEY` and the
athlete's existing connection; do not copy credentials into arguments/logs.

```sh
npm run dynamics:backfill -- --email runner@example.com --since 2025-11-01 --through 2026-10-25 --limit 10 --apply
```

This makes **live provider reads and DB writes**. One activity runs at a time
(concurrency 1), one detail GET per attempt, at most three attempts per selected
activity/invocation. No summary discovery or proxy fallback doubles the request
budget. Each GET requests `maxChartSize=20000&maxPolylineSize=10`, timeout 30s.
Authentication uses existing `openGarminSession`/remembered-password/MFA behavior;
it can refresh/re-authenticate in addition to the printed detail-request budget.
Fresh auth is immediately persisted using token ownership plus ciphertext CAS,
before any detail fetch. The response interceptor is disabled after explicit
auth setup to avoid hidden refresh/replay loops. An auth rejection stops the run;
normal reconnect/sync or MFA verification must resolve it before resuming.

Retries wait 2s/4s minimum and honor `Retry-After` seconds or HTTP dates. A wait
over five minutes is deferred, not shortened. Failed checkpoints carry at least
a 15-minute cooldown (or longer provider-requested wait). There is a durable
three-attempt budget across normal resumes. After fixing a cause, explicitly use
`--retry-failed --apply` to allow up to three additional attempts per selected
activity; cooldown still applies. Counts/attempts are never reset.

## Completion and data preservation

`dynamics-detail-v1` is a per-activity successful detail-attempt contract. Existing
`samples_fetched_at`, `sample_count`, and any populated summary are **not** proof
of completion. The mapper is the shared `activity-detail.mjs` mapper and retains
its cm/ms/percentage-point, explicit LEFT balance and independent-null policy.
Missing descriptors stay unavailable, never inferred from cadence or summaries.

Before success, the tool requires an explicit full-detail row array, descriptors,
an integer `totalMetricsCount` matching returned rows, no 20,000-row cap hit,
unique elapsed keys and timestamp/elapsed alignment. Summary-only or ambiguous
empty/malformed/truncated results fail. An explicit zero-row detail response can
be terminal unavailable only if no stored samples contradict it. If samples
already exist, their count, keys and timestamps must match exactly; a changed
provider sampling grid fails `stored_alignment_changed`, with no partial writes.
Reconcile those cases separately; this tool never deletes/resamples existing data.

Dynamics columns alone are patched, in chunks of 500 inside one activity
transaction. Existing IDs, timestamps, HR/power, other sample metrics, provider
summaries, plan/workout matching, user overrides/exclusions and analytics caches
are untouched. A missing new metric cannot erase a stored measured value. Where
there were no samples, only actual mapped dynamics/time rows are inserted; other
metrics stay null. General ingestion metadata (`sample_count`, `samples_fetched_at`)
is not rewritten by this dynamics-only tool; use the coverage report for actual
stored counts. No sample IDs are replaced and no summary metric is smeared across
samples. Every returned nonnull value is read back and compared, and stored row
count/time alignment is verified before the success checkpoint commits atomically.
Checkpoint `coverage` describes the fetched trace; aggregate before/after counts
describe storage, including previously measured values preserved through nulls.

Any valid trace with dynamics is `succeeded`; zero valid dynamics is `unavailable`.
Per-metric zero counts (e.g. race balance) remain explicitly unavailable; they do
not trigger endless refetches. Terminal checkpoints skip subsequent requests for
this version unless the stored sample count changes. A future mapper/contract
needs a new version rather than using a summary field to invalidate checkpoints.

## Cancellation, ownership and resume

Press Ctrl-C or send SIGTERM. The tool stops between attempts/activities, aborts
backoff immediately and lets an in-flight fetch/atomic activity finish. Repeat the
same scope to resume. `running` checkpoints from interruption are eligible within
the remaining retry budget; transactional failure cannot leave half an activity
marked complete. Exit status is nonzero on cancellation/failure.

The tool takes the existing `garmin-export:<user-id>` session advisory lock and
the normal connection worker lease. It never takes an app/job/legacy worker's
token, even when expired, and never clears `active_job_id`. Its prefixed
`dynamics:<uuid>` tokens have a 10-minute lease, renewed before attempts; bounded
fetch/backoff fits within it. After SIGKILL/crash, wait for expiry and rerun: only
an expired dynamics-tool token with no active job can be reclaimed, and only
after the advisory lock is acquired (a still-connected prior backfill blocks it).
An existing live worker requires waiting, not clearing its ownership. A stalled
unrelated worker requires its established operator recovery, outside this tool.
Lost ownership fences activity commits and token persistence. Finally releases
only this run's token; newer tokens and leases survive. Durable checkpoints hold
only version/status/counts/whitelisted error codes, never private payloads or auth.

## Local verification

`src/test/dynamics-backfill.test.ts` tests parsing, trace validation, metric counts
and retry policy. `src/test/dynamics-backfill.integration.test.ts` uses isolated
PostgreSQL schemas plus synthetic Garmin responses to exercise the real CLI,
transactions, readonly inventory, idempotence, alignment/count failures, ownership,
interruption, MFA/auth and rate limits. Set `TEST_DATABASE_URL` to a disposable
PostgreSQL instance. No tests call live Garmin or production services.
