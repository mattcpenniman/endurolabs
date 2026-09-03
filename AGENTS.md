# EnduroLab — Project Context for AI Agents

## What is this project?
A **science-backed marathon training planner** that generates personalized week-by-week training plans based on runner profiles, pace zones, and goal race times. Built around Daniels' Running Formula methodology with Apple Watch power data integration.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode, `@/*` path alias to `src/`)
- **Styling:** Tailwind CSS 3.4 + `@tailwindcss/typography` plugin + custom CSS design tokens
- **Testing:** Vitest 3 + jsdom environment
- **Charts:** Recharts
- **Utilities:** dayjs (dates), ics (calendar export)
- **Fonts:** Inter (sans), JetBrains Mono (mono) — defined as CSS custom properties

## Architecture

```
src/
├── app/
│   ├── layout.tsx          # Root layout, metadata, minimal shell
│   ├── globals.css         # Tailwind directives, design tokens, base reset, utility components
│   ├── api/                # Plan, stats, auth, and Garmin integration routes
│   └── components/         # UI components organized by domain
│       ├── charts/         # Recharts visualizations (mileage trends, long run progression)
│       ├── layout/         # Header, navigation, containers
│       ├── onboarding/     # Runner profile input forms
│       └── plan/           # Plan display, weekly/daily views
├── lib/
│   ├── activities/         # Persisted activity API models
│   ├── analytics/          # Power/HR fitness and plan comparison models
│   ├── db/                 # Drizzle client and PostgreSQL schema
│   ├── garmin/             # Authentication, summary/detail mapping, ingestion
│   └── training/           # Core training logic (pure functions, no UI deps)
└── test/                   # Vitest domain, Garmin, analytics, and smoke tests
```

## Domain Models (key types)

| Type | Purpose |
|------|---------|
| `RunnerProfile` | User inputs: mileage history, PRs, goal time, race date, available days, injury history |
| `PaceZones` | Calculated training paces (easy range, marathon, threshold, VO2, recovery) + RPE descriptors |
| `PowerZones` | Optional Apple Watch power equivalents (watts) for each pace zone |
| `Workout` / `WorkoutSegment` | Single workout with structured segments (distance, pace, power, effort, reps) |
| `DailyPlan` / `WeeklyPlan` | Day and week structures within the generated plan |
| `MarathonPlan` | Complete plan: runner profile, zones, phases, weeks, goal assessment, risk warnings |
| `GoalAssessment` | Feasibility rating + reasoning for the runner's goal time |
| `TrainingPhase` | `base` → `marathon_build` → `peak_taper` |

### Persisted Running Data

| Table | Purpose |
|-------|---------|
| `run_activities` | Provider activity summaries, plan matching, analytics inclusion, quality score, and detail-ingestion status (`sample_count`, `samples_fetched_at`) |
| `activity_samples` | High-resolution activity metrics keyed by `(activity_id, elapsed_seconds)`: time, distance, HR, power, speed, elevation, grade, cadence, GPS, and temperature |
| `weight_measurements` | Timestamped body weight used for W/kg analytics |
| `fitness_snapshots` | Versioned plan-headline analytics cache keyed by user, time window, power source, and algorithm version |

## Garmin Data Ingestion

- Summary sync: `src/app/api/integrations/garmin/sync/route.ts`
- Detail API: `src/app/api/integrations/garmin/samples/route.ts`
- Detail mapping: `src/lib/garmin/activity-detail.ts`
- Idempotent sample persistence: `src/lib/garmin/sample-ingestion.ts`
- Foreground refresh runs in order: incrementally upsert summaries, ingest recent missing detail, compute summary quality, then allow the stats read. Summary discovery uses `garmin_connections.last_sync_at` as a 15-minute TTL and fetches from the newest persisted Garmin activity through a captured current-time boundary.
- Detail rows upsert on `(activity_id, elapsed_seconds)`; do not replace this with duplicate inserts.
- Garmin fetches use the stored encrypted session and a fixed concurrency of 2 to limit proxy pressure.
- `samples_fetched_at` records an attempted successful response; `sample_count = 0` can be valid when Garmin returns no time-series metrics.
- `quality_score` uses the versioned `detail-v1` formula in `src/lib/analytics/activity-quality.ts`: HR coverage, power coverage, GPS coverage, duration coverage, and steady-state share. The sample-analytics threshold is 60; empty detail scores 0.
- The dev seed creates synthetic fixtures only. Production Garmin ingestion removes timestamp-inconsistent seed rows when real detail is imported.
- Historical summary import: `npm run garmin:history -- --since YYYY-MM-DD`
- Missing/all detail backfill: `npm run samples:backfill -- --only-missing` or `npm run samples:backfill`
- Detail-derived summary recompute: `npm run summaries:recompute` (preview with `npm run summaries:recompute -- --dry-run`; target a user with `--email runner@example.com`).
- `summaries:recompute` is DB-only and does not contact Garmin. It processes activities one at a time, always refreshes `sample_count` and `quality_score`, and rebuilds distance, duration, moving duration, average/max HR, average power, and cadence only when stored detail covers at least 95% of the original duration. Partial traces retain their provider summary metrics; valid empty responses score 0.
- Standalone Garmin scripts load `.env` and require `GARMIN_TOKEN_ENCRYPTION_KEY` to decrypt the existing connection. Never generate a replacement key while encrypted sessions remain in the DB.
- The summary recompute script only needs `DATABASE_URL`; unlike Garmin history/detail scripts, it does not decrypt or update Garmin sessions.
- Garmin summary upserts preserve an existing non-null `average_power` and its `power_source` when the incoming Garmin summary has null power. This protects explicitly modeled or detail-recomputed summary power from null historical payloads.

## Modeled Missing Power

- Newport Marathon 2026 has 21 measured-power activities from April 1-19, 2026 and 206 earlier null-power activities from November 17, 2025 through April 1, 2026.
- The athlete-specific summary model is `watts = -33.526863 + 117.849963 * speed_meters_per_second`. Speed is activity distance divided by moving duration, falling back to total duration.
- Do not reuse these coefficients for another athlete or plan. Refit and validate with `npm run power:analyze -- --plan-id UUID`; add `--apply` only after its accuracy gates pass.
- Newport summary validation: leave-one-run-out MAE 4.7 W, RMSE 6.0 W, bias 0.0 W, and R2 0.934. A 14-run near-term temporal holdout produced MAE 14.9 W, RMSE 16.4 W (5.1%), and bias 14.9 W.
- The 206 applied Newport estimates range from 254-389 W. They are stored only in `run_activities.average_power` with `power_source = 'estimated_speed_v1'`; `activity_samples.power` remains null so modeled data cannot be mistaken for sensor measurements.
- The stats page displays distance-weighted average power separately. A leading `~` and dashed chart lines indicate weeks containing modeled summaries.
- For modeled weekly Power @ 140, `src/lib/analytics/modeled-power.ts` refits the speed/power relationship from measured summaries. `loadModeledFitnessWindowData()` applies it to stored speed samples in memory, then the normal 30-second lagged-HR pipeline computes Power @ 140. Synthetic sample power is never persisted.
- Exact downstream Newport backtest: modeled versus measured plan headline Power @ 140 was 338.6 W versus 336.1 W (2.5 W error). Leave-one-week-out validation across three measured weeks produced MAE 10.1 W, RMSE 10.4 W, bias -4.6 W, and maximum absolute error 13.7 W; none of the three estimates extrapolated beyond the observed HR range.
- Per-activity modeled Power @ 140 is not approved: leave-one-activity-out MAE was 26.4 W, RMSE 34.0 W, and maximum error 64.7 W. Keep modeled Power @ 140 limited to weekly/plan trends and visually distinct from measured Power @ 140.
- Re-run the exact downstream validation with `npm run power:p140-backtest -- --plan-id UUID`.

## Conventions

### Code Style
- **Strict TypeScript** — no `any`, explicit return types on exported functions
- **JSDoc block headers** on file-level modules (see existing `models.ts`, `zone-calculator.ts`)
- **Descriptive interface names** with inline comments for non-obvious fields
- **Pure functions** in `lib/training/` — no side effects, no UI dependencies
- **Time stored as minutes** (numbers), formatted only at the UI layer via `formatTime()` / `formatPace()`

### Styling
- **Custom Tailwind colors:** `enduro.*` (brand green palette), `intensity.*` (workout type colors)
- **CSS custom properties** for theming (`--color-bg`, `--color-text`, etc.)
- **Utility classes** in `globals.css` (`.container-narrow`, `.section-padding`, `.scrollbar-thin`)
- Prefer Tailwind utility classes over custom CSS for component-level styling

### Component Organization
- Components live under `src/app/components/` grouped by domain (charts, layout, onboarding, plan)
- API routes under `src/app/api/` for server-side plan generation
- Keep UI imports one-directional: components → lib, never lib → components

### Testing
- Vitest with jsdom, globals enabled
- Tests belong in `src/test/`
- Test pure domain logic in `lib/training/` first (zone calculator, models, time utilities)
- Test Garmin payload mapping as pure logic; DB idempotency requires an integration test against PostgreSQL.

## Key Configuration
- `package.json` scripts include app lifecycle, `db:push`, user/plan utilities, `seed:dev`, `garmin:history`, `samples:backfill`, `summaries:recompute`, and Vitest commands
- `tsconfig.json`: strict mode, `@/*` → `./src/*`, ES2017 target, bundler module resolution
- `vitest.config.ts`: jsdom environment, React plugin, globals true
- `next.config.js`: default (empty) config
- `tailwind.config.ts`: custom `enduro` and `intensity` color palettes, typography plugin

## Science Behind the Zones
Zone calculation uses a **VDOT approximation** derived from race times (marathon PR → half PR → goal time fallback), then applies **Daniels'-derived pace factors**:
- Easy: ~1.55× marathon pace (faster runners get lower multiplier)
- Recovery: ~1.1× easy pace
- Threshold: ~1.18× marathon pace
- VO2: ~1.3× marathon pace

Apple Watch power data is supported as optional anchors for power-based training zones.
