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
│   ├── api/                # Route handlers (plan generation/export)
│   └── components/         # UI components organized by domain
│       ├── charts/         # Recharts visualizations (mileage trends, long run progression)
│       ├── layout/         # Header, navigation, containers
│       ├── onboarding/     # Runner profile input forms
│       └── plan/           # Plan display, weekly/daily views
├── lib/
│   └── training/           # Core domain logic (pure functions, no UI deps)
│       ├── models.ts       # All shared TypeScript interfaces + time utilities
│       └── zone-calculator.ts  # VDOT estimation, pace/power zone calculation
└── test/                   # Vitest test files (currently empty)
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

## Key Configuration
- `package.json` scripts: `dev`, `build`, `start`, `lint`, `test`, `test:watch`
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
