# Garmin connection lifetime and background refresh

## Library and lifetime

EnduroLab uses **`garmin-connect-client` (`^1.2.0`)**, an unofficial Garmin Connect integration. `src/lib/garmin/client.ts` restores encrypted OAuth1/OAuth2 sessions and exchanges the stored OAuth1 credential for fresh OAuth2 access tokens when access expiry is within one hour (including already expired access tokens). It persists the returned session rather than changing Garmin's expiry timestamps.

The objective is to stay connected for a year without daily manual login. This is **best effort, not a one-year token guarantee**: Garmin controls credential lifetime, revocation, MFA, and service availability. We cannot extend a revoked/expired OAuth1 credential or bypass a new MFA challenge. No artificial expiry extension, new credential store, or automatic password login is added by this service.

## Background service

The existing `npm run garmin:worker` service now calls the worker-secret-protected `POST /api/internal/garmin-session-maintenance` endpoint before its normal activity-job pass. No browser activity or scheduled import is required. Each request:

1. Finds at most one due `connected` connection. Pending MFA, errors, and disconnected/deleted connections are not selected.
2. Atomically claims the same five-minute connection lease used by sync/jobs and advances `next_token_check_at` by 30 minutes. Competing workers recheck eligibility when claiming.
3. Opens the existing session **without password fallback**. Near-expiry access tokens refresh through the existing client; healthy tokens require no Garmin request.
4. Saves the latest encrypted session with an ownership fence, then releases only its own lease. It does not change `last_sync_at`, download activities, or claim an activity sync succeeded.

Failures retain old tokens, record only a generic diagnostic, and retry no sooner than the next due check. A crash leaves a bounded lease and durable next-check time. Multiple workers coordinate through the DB claim. Disconnection/deletion or another owner taking over prevents stale maintenance writes. Existing opt-in Remember me recovery during interactive sync/imports is unchanged; runners still enter new Garmin MFA codes themselves.

The worker has a 65-second maintenance HTTP timeout. Each Garmin request has the existing 30-second timeout. A maintenance pass cannot starve activity work with an unbounded batch. Normal idle worker polling is every five seconds; the 30-minute DB schedule controls per-account checks, not per-poll OAuth calls.

## Rollout (not performed by this issue)

1. Back up and apply `scripts/add-garmin-session-maintenance.sql` **before deploying the app** (shared schema selects include the new nullable column). Alternatively use the project's normal authorized Drizzle migration process. The additive migration is rerunnable.
2. Deploy the compatible app and worker. The existing Compose `garmin-worker` service already runs with `restart: unless-stopped`; no separate daemon, public cron, or new secret is needed.
3. Preserve the existing `GARMIN_TOKEN_ENCRYPTION_KEY`, `GARMIN_WORKER_SECRET`, database, and stored sessions. Do not regenerate keys. App requires database/encryption configuration; worker uses only `WORKER_APP_URL` and the worker secret.
4. Verify the protected endpoint is inaccessible without the worker secret, connected accounts' next-check timestamps advance, and a due OAuth expiry rotates the encrypted session without changing activity sync timestamps. Inspect metadata only; never print token payloads or sealed passwords. Confirm disconnected/MFA accounts are not contacted.
5. If a runner still sees daily login, distinguish Garmin connection errors from EnduroLab's own web-login session; this service does not change application authentication-cookie lifetime.

To stop background refresh, stop the worker (also stops background activity imports), or roll back both app and worker together. Leave the additive column in place while compatible code is deployed. Revoking/disconnecting Garmin stops maintenance eligibility; the service never reconnects a disconnected account.

## Validation scope

Unit tests cover worker endpoint authentication, claim loss, encrypted persistence, lease release, pending MFA, and sanitized failure handling. Existing session tests cover healthy, near-expiry, expired, credential recovery and MFA behavior. These mocks do not establish PostgreSQL race behavior, live Garmin acceptance, or a measured year of continuity; those require authorized integration/operational checks after rollout.
