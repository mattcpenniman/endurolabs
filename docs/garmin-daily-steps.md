# Garmin daily steps

Garmin Connect exposes daily wellness step totals via
`GET /usersummary-service/stats/steps/daily/{startDate}/{endDate}` on
`https://connectapi.garmin.com`. This is the **unofficial Garmin Connect API**, not
an approved Garmin Health API integration or a promise of indefinite retention.
The response is an array of `calendarDate` / `totalSteps` rows. Historical
availability depends on what the runner's Garmin account has synced.

Source checked during VEC-2211 implementation: the maintained
[python-garminconnect health module](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/api/health.py)
(`get_daily_steps`) and
[base URL definitions](https://github.com/cyberjunky/python-garminconnect/blob/master/garminconnect/api/base.py).
That client documents a maximum **28 inclusive days per request**. The installed
`garmin-connect-client` 1.2.0 does not wrap this endpoint; we reuse its authenticated
HTTP transport, as with activity detail/history. No live athlete account was used
for implementation validation.

## Product behavior

- Opening a saved plan week first loads persisted daily totals and then imports
  that week's dates through today. Older weeks therefore import lazily too.
- While a saved week stays expanded and the tab is visible, steps refresh every
  hour and at the next **browser-local midnight**, whichever comes first. The
  midnight refresh reimports the displayed dates (including the day that just
  ended) and includes the new day if it belongs to that week. This is not a
  guarantee that Garmin has finalized the previous day's total at midnight;
  subsequent hourly imports can pick up corrections.
- Hidden tabs do not poll. Returning to the tab catches up once if the hourly or
  midnight refresh is due; it does not replay every missed interval. Collapsing
  the week or leaving the page stops its refresh timer. There is no closed-page
  sync or server-side steps schedule. Only expanded weeks are refreshed.
- Reloading/reopening a saved week or clicking **Refresh daily steps** also
  requests an import, subject to the server cache below. Ordinary activity sync
  is separate and does not refresh steps. Sync the device to Garmin Connect first
  if its daily total is behind the watch.
- Every available day's header has a footprint icon and formatted step count,
  including rest days and true zero totals. Missing totals have no badge.
- The week header shows the **weekly steps total** and **steps/day average** once
  its daily totals load, with `N/7 days with data` (or the actual number of dates
  in the week). It remains visible after collapsing a loaded week, without
  starting extra requests for collapsed weeks. The average divides by days with
  imported totals only, including rest days and true zeros, never missing or
  future days. Incomplete weeks and totals including today are labeled **so far**;
  today's incomplete total is included in the average. Entirely unavailable or
  future weeks show no summary. The summary updates with the same daily refresh.
- Today is labeled **so far**. These are the last imported Garmin totals, not a
  live pedometer. Steps include running and non-running activity; they are never
  added to mileage, readiness, run scores, or activity records.
- Only the authenticated owner's data is loaded. The shared-plan page does not
  use this component or steps API; steps do not enter public plan JSON.
- Errors are non-blocking and offer **Retry steps**. A busy activity/maintenance
  worker returns a conflict rather than starting another Garmin session. If the
  foreground activity sync wins the connection lease, retry steps after it ends.
- Recent dates (last seven days) are eligible for a provider refresh after 15
  minutes; older dates after six hours. These are server cache TTLs, **not polling
  intervals**. Manual and automatic refresh both obey them. Missing dates have
  nullable checkpoints, not fake zeros. Empty responses do not erase known
  historical totals.
- The existing connection lease fences ingestion and token persistence. The
  session is restored/refreshed and encrypted tokens saved before requesting
  history. This feature never attempts password login, MFA, or changes the
  connection's activity-sync timestamp. Failures do not mark activity sync broken.

## Deployment and historical import

Apply `scripts/add-garmin-daily-steps.sql` **before** deploying the app. It creates
`garmin_daily_steps`, keyed by `(user_id, local_date)` with cascading user deletion.
It is additive and safe to rerun. There is no automatic full-account backfill or
scheduled steps worker; ordinary week expansion imports just that week.

For a larger history import, explicitly select one user and date range:

```sh
npm run steps:backfill -- --email runner@example.com --since 2025-01-01 --through 2026-11-25
# Preview only: no DB/Garmin access. Once rollout/import is authorized:
npm run steps:backfill -- --email runner@example.com --since 2025-01-01 --through 2026-11-25 --apply
```

The command requires the existing `DATABASE_URL` and `GARMIN_TOKEN_ENCRYPTION_KEY`
for apply, loads `.env`, and never replaces encryption keys. It imports sequential
28-day chunks (at most ten years per invocation), committing/checkpointing each
chunk. It stops on failure/lease conflict; rerun the same range to resume, with
fresh checkpoints skipped. API reads are idempotent; repeated dates update totals,
not duplicate rows. A currently valid connected Garmin session is required.
Production migration, deployment, and bulk import are separate operational actions;
none were performed by this implementation.

## Validation

- Pure mapping/range/chunk tests: `src/test/garmin-daily-steps.test.ts`.
- Private API/security/error tests: `src/test/garmin-daily-steps-api.test.ts`.
- Badge/lazy-loading/retry tests: `src/test/garmin-daily-steps-ui.test.tsx`.
- Real PostgreSQL ingestion tests: set `STEPS_TEST_DATABASE_URL` to an isolated
  disposable database already initialized with the Drizzle schema, then run
  `npm test -- src/test/garmin-daily-steps.integration.test.ts`. Transport and tokens
  are mocked; owner isolation, upsert corrections, empty preservation, TTL,
  atomic malformed-response rejection and lease fencing use real PostgreSQL.
