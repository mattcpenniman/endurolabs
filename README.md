# EnduroLab — Marathon Training Planner

A science-backed marathon training planner that generates personalized, week-by-week training plans based on runner profiles, pace zones, and goal race times. Built around Daniels' Running Formula methodology with Apple Watch power data integration.

Plans are persisted to PostgreSQL per authenticated user, so each runner only sees their own saved plans.

## Features

- **Personalized plans** — Based on your current fitness, PRs, weekly mileage, and race date
- **Pace zones** — Easy, recovery, threshold, VO2 max, and marathon pace calculated via VDOT estimation
- **Power zones** — Optional Apple Watch running power equivalents
- **Visual charts** — Mileage trends, long run progression, intensity distribution
- **Calendar export** — Download your plan as an `.ics` file for Google/Apple/Outlook Calendar
- **Goal assessment** — Feasibility rating (Feasible / Plausible / Ambitious / Unrealistic) with risk warnings
- **Adjustment guidelines** — Built-in rules for fatigue, illness, injury, and sleep
- **User overrides** — Adjust peak weekly mileage and training week count to suit your schedule
- **Login-protected plans** — Saved plans are behind an HTTP-only session login and scoped per user
- **Plan persistence** — Save and reload user-specific plans across sessions via PostgreSQL

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 3.4
- **Charts:** Recharts
- **Testing:** Vitest 3 + jsdom
- **Utilities:** dayjs, ics

## Historical plan analysis

Pull saved plan details as JSON without regenerating or changing the plan:

```bash
npm run plan:details -- --email runner@example.com --list
npm run plan:details -- --email runner@example.com
npm run plan:details -- --email runner@example.com --date 2027-02-16
npm run plan:details -- --plan-id PLAN_UUID --week 16
```

`--email` selects the designated current plan; `--plan-id` selects an exact saved
plan. A day includes both runs on double days and the plan's pace/power zones.
Requires `DATABASE_URL` from the environment or `.env`. Use `npm run --silent
plan:details -- ...` (or `node scripts/plan-details.mjs ...`) for clean JSON when
piping output. This command is read-only and does not contact Garmin.

Compare the current marathon plan with past race cycles and same-race drafts:

```bash
npm run planner:recommend -- --email runner@example.com --goal 2:59:59 --history
npm run planner:recommend -- --plan-id PLAN_UUID --history --json
```

`--email` uses the athlete's designated current plan, falling back to the newest
created plan. `--plan-id` selects a specific draft. Add `--as-of YYYY-MM-DD` to
exclude activities on and after a cutoff day.

The history report compares scheduled and recorded mileage and long-run counts
over the same final 112 days before each marathon. It includes race result
provenance, execution classifications, alternative drafts, goal-pace benchmarks,
and evidence-linked recommendations with candidate build weeks to review.
Canonical race results are deduplicated from Garmin activities; a target race
does not count toward its own preparation. Historical schedules may have been
reconstructed or edited, and recorded training may omit manual-only runs.

This analysis is read-only. It does not change the saved plan or assign a
probability of reaching the goal. Forecast ranges reflect historical errors,
not calibrated prediction intervals. Run with `--help` for creation-preview
options; `--history` and `--create` are separate modes.

## Getting Started

### Run with Docker

Bring up the full app stack, including PostgreSQL, with one command:

```bash
docker compose up --build
```

This starts the app at **`http://localhost:${PORT:-3000}`** and initializes the database schema automatically. To run it in the background:

```bash
docker compose up --build -d
```

Stop the stack with:

```bash
docker compose down
```

Create a login user inside the running Docker app container:

```bash
docker compose exec app npm run user:create -- --email runner@example.com --password 'change-me-please' --name 'Runner Name'
```

List users from inside the running Docker app container:

```bash
docker compose exec app npm run user:list
```

Reset a user's password from inside the running Docker app container:

```bash
docker compose exec app npm run user:set-password -- --email runner@example.com --password 'new-secret-pass'
```

Set `APP_URL` in `.env` to control the domain used for generated read-only share links:

```bash
APP_URL=https://training.example.com
```

### Prerequisites

- Node.js 18+ (Node 20+ recommended)
- npm

### Install dependencies

```bash
npm install
```

### Start the development server

```bash
npm run dev
```

This starts the app on **`http://localhost:3000`**.

### Google sign-in

Sign-in uses Google and matches Google's verified email to an existing EnduroLab user.
The existing user ID, plans, Garmin connection, preferences, and history are retained.
Unknown emails are rejected; signing in does not create another account. Password
sign-in is disabled.

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client
   of type **Web application**. If the consent screen is in Testing, add your
   runners as test users.
2. Register the exact authorized redirect URI
   `https://your-domain/api/auth/google/callback`. For the current deployment this
   is `https://spacetimeapollo.com/api/auth/google/callback`. For local development,
   also register `http://localhost:3000/api/auth/google/callback`.
3. Set `APP_URL`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` in `.env` and
   restart/recreate the app container so it receives the new environment.
4. Open `/login` and choose **Continue with Google** using the email already
   stored on your EnduroLab account.

The client secret stays server-side. OAuth uses short-lived, HTTP-only state/PKCE
cookies and the existing 30-day EnduroLab session; Google access tokens are not stored.
Until credentials are configured, the login page shows a setup message.

### Create a user

After the database schema has been pushed (`npm run db:push`, or automatically through Docker), create a login user from the backend.

With Docker:

```bash
docker compose exec app npm run user:create -- --email runner@example.com --password 'change-me-please' --name 'Runner Name'
```

For a local Node process:

```bash
npm run user:create -- --email runner@example.com --password 'change-me-please' --name 'Runner Name'
```

The command uses `DATABASE_URL` when set. If it is not set, it defaults to:

```bash
postgresql://enduro:endurodev@localhost:5432/endurolab
```

### List users

List the current users from the backend:

With Docker:

```bash
docker compose exec app npm run user:list
```

For a local Node process:

```bash
npm run user:list
```

Add `-- --json` if you want machine-readable output.

### Update a user's password

Reset a user's password from the backend by email or user id. This also revokes that user's active sessions so they need to log in again with the new password.

With Docker:

```bash
docker compose exec app npm run user:set-password -- --email runner@example.com --password 'new-secret-pass'
```

For a local Node process:

```bash
npm run user:set-password -- --email runner@example.com --password 'new-secret-pass'
```

You can target by id instead of email:

```bash
npm run user:set-password -- --id 11111111-2222-3333-4444-555555555555 --password 'new-secret-pass'
```

### Create a plan from the CLI

`planner:recommend` analyzes an athlete and can generate and persist a new plan without the UI. Preview first:

```bash
npm run planner:recommend -- --email runner@example.com \
  --create --race-date 2027-04-17 --goal 2:59:59 --name "Newport Marathon 2027" --weeks 28
```

Add `--apply --set-current` to create the plan and make it the athlete's current plan. Creation starts from the athlete's most recent stored plan (or `--plan-id UUID`), requires `--race-date` and `--goal`, and refuses to apply when the plan's calendar or safety gates fail. Use `--reset-weekly-overrides` for a fresh cycle that drops the base plan's per-week mileage and intensity overrides; `--max-weekly-mileage`, `--max-long-run`, `--days`, `--long-run-day`, and `--no-doubles` apply constraints. Add `--json` for a machine-readable proposal.

Read-only analysis of an existing plan:

```bash
npm run planner:recommend -- --email runner@example.com
```

### Compare two plans

`plan:compare` reports how a plan's planned load differs from the previous cycle (or any stored plan):

```bash
# Current plan vs the previous race cycle
npm run plan:compare -- --email runner@example.com

# Explicit pair (newest is labeled After)
npm run plan:compare -- --plan-id PLAN_ID --against OTHER_PLAN_ID
```

It covers total and peak volume, weeks near peak, long-run exposure, threshold/marathon-pace/VO2 mileage, recovery weeks, and taper reduction. Add `--json` for a machine-readable `plan-compare-v1` payload.

Training plans under `/plan` require login. Newly generated and saved plans are tied to the signed-in user.

### Change the port

By default Next.js uses port 3000. To use a different port:

```bash
# Option 1: One-off
PORT=8080 npm run dev

# Option 2: Add to package.json scripts
# "dev": "next dev -p 8080"

# Option 3: Create a .env.local file
# PORT=8080
```

### Change the share-link domain

Share links use `APP_URL` from `.env` when creating/copying read-only plan URLs. Set it to the public domain where the app is reachable:

```bash
APP_URL=https://training.example.com
```

### Build for production

```bash
npm run build
```

### Start the production server

```bash
npm start
```

### Run tests

```bash
# Run all tests once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch
```

## Project Structure

```
src/
├── app/
│   ├── api/auth/           # Login, logout, and current user routes
│   ├── api/plan/           # Authenticated API routes (generate, save, list, export)
│   ├── components/
│   │   ├── charts/         # MileageTrendChart, LongRunProgressionChart, IntensityDistributionChart
│   │   ├── layout/         # Header, Footer
│   │   ├── onboarding/     # OnboardingForm (4-step)
│   │   └── plan/           # PlanOverviewCard, PaceZonesCard, WeeklyPlanCard
│   ├── layout.tsx          # Root layout
│   ├── login/page.tsx      # Login page
│   ├── page.tsx            # Home page
│   ├── plan/page.tsx       # Plan generation page
│   └── globals.css         # Tailwind + design tokens
├── lib/
│   ├── auth.ts             # Password hashing, session cookies, authenticated user lookup
│   ├── db/                 # Drizzle client and PostgreSQL schema
│   └── training/
│       ├── models.ts           # TypeScript interfaces & time utilities
│       ├── zone-calculator.ts  # VDTO pace/power zone math
│       ├── workout-library.ts  # Workout template factory
│       ├── plan-generator.ts   # Core plan assembly engine
│       ├── goal-assessment.ts  # Feasibility engine
│       └── calendar-export.ts  # ICS calendar generation
├── scripts/
│   ├── create-user.mjs     # Backend user creation tool
│   └── user-admin.mjs      # Backend user listing + password reset tool
└── test/
    ├── zone-calculator.test.ts
    ├── goal-assessment.test.ts
    ├── plan-generator.test.ts
    └── calendar-export.test.ts
```

## Authentication

EnduroLab uses first-party email/password authentication:

- Passwords are stored as salted `scrypt` hashes.
- Sessions are stored in PostgreSQL and referenced by an HTTP-only `endurlab_session` cookie.
- `/api/plan/*` routes require an authenticated session.
- Saved plans include a `user_id` and list/load/save operations are filtered to the signed-in user.

The schema is managed through Drizzle:

```bash
npm run db:push
```

This creates or updates the `users`, `sessions`, and `plans` tables.

## How It Works

1. **Fill in your profile** — Goal time, race date, current mileage, PRs, training days, preferences
2. **VDOT estimation** — Your race times are used to estimate your VDTO (max oxygen uptake proxy)
3. **Zone calculation** — Daniels-derived pace factors convert VDTO into training zones
4. **Plan generation** — The engine divides your timeline into Base → Marathon Build → Peak & Taper phases, then assigns workouts week by week. The build ramps in three-week blocks (two build weeks plus a recovery week), and the final weeks taper to 70/70/60% of peak as documented in `docs/elite-training-plan.md`
5. **Goal assessment** — Compares your goal against your current fitness, mileage history, and available time

## Color Palette

The app uses a custom Tailwind palette:

- **`enduro`** — Brand green (50–950)
- **`intensity`** — Workout type colors (easy, recovery, threshold, marathon, vo2, long, strength, rest)

## License

MIT
