# EnduroLab — Marathon Training Planner

A science-backed marathon training planner that generates personalized, week-by-week training plans based on runner profiles, pace zones, and goal race times. Built around Daniels' Running Formula methodology with Apple Watch power data integration.

Plans are persisted to PostgreSQL so you can load and revisit them across sessions.

## Features

- **Personalized plans** — Based on your current fitness, PRs, weekly mileage, and race date
- **Pace zones** — Easy, recovery, threshold, VO2 max, and marathon pace calculated via VDOT estimation
- **Power zones** — Optional Apple Watch running power equivalents
- **Visual charts** — Mileage trends, long run progression, intensity distribution
- **Calendar export** — Download your plan as an `.ics` file for Google/Apple/Outlook Calendar
- **Goal assessment** — Feasibility rating (Feasible / Plausible / Ambitious / Unrealistic) with risk warnings
- **Adjustment guidelines** — Built-in rules for fatigue, illness, injury, and sleep
- **User overrides** — Adjust peak weekly mileage and training week count to suit your schedule
- **Plan persistence** — Save and reload plans across sessions via PostgreSQL

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 3.4
- **Charts:** Recharts
- **Testing:** Vitest 3 + jsdom
- **Utilities:** dayjs, ics

## Getting Started

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
│   ├── api/plan/           # API routes (generate, export)
│   ├── components/
│   │   ├── charts/         # MileageTrendChart, LongRunProgressionChart, IntensityDistributionChart
│   │   ├── layout/         # Header, Footer
│   │   ├── onboarding/     # OnboardingForm (4-step)
│   │   └── plan/           # PlanOverviewCard, PaceZonesCard, WeeklyPlanCard
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home page
│   ├── plan/page.tsx       # Plan generation page
│   └── globals.css         # Tailwind + design tokens
├── lib/training/
│   ├── models.ts           # TypeScript interfaces & time utilities
│   ├── zone-calculator.ts  # VDTO pace/power zone math
│   ├── workout-library.ts  # Workout template factory
│   ├── plan-generator.ts   # Core plan assembly engine
│   ├── goal-assessment.ts  # Feasibility engine
│   └── calendar-export.ts  # ICS calendar generation
└── test/
    ├── zone-calculator.test.ts
    ├── goal-assessment.test.ts
    ├── plan-generator.test.ts
    └── calendar-export.test.ts
```

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
