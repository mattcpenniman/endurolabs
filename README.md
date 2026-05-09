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
│   └── create-user.mjs     # Backend user creation tool
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
4. **Plan generation** — The engine divides your timeline into Base → Marathon Build → Peak & Taper phases, then assigns workouts week by week
5. **Goal assessment** — Compares your goal against your current fitness, mileage history, and available time

## Color Palette

The app uses a custom Tailwind palette:

- **`enduro`** — Brand green (50–950)
- **`intensity`** — Workout type colors (easy, recovery, threshold, marathon, vo2, long, strength, rest)

## License

MIT
