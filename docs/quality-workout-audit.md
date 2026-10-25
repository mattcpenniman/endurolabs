# Reviewing saved quality workouts

Inspect the **saved** plan, rather than assuming it matches today's generator:

```sh
npm run plan:details -- --email runner@example.com --list
npm run plan:details -- --plan-id UUID --quality
npm run plan:details -- --plan-id UUID --quality --week 12
npm run plan:details -- --plan-id UUID --quality --date 2027-04-12 --json
```

`--email` selects the athlete's current plan. Use `--plan-id` for an older plan
or draft. The command enforces a PostgreSQL read-only transaction, does not
contact Garmin, and does not regenerate or change workouts. Existing commands
without `--quality` retain their JSON output. Quality output is human-readable
by default; `--json` returns the versioned `quality-audit-v1` report.

## What is included

- Runs with M, T, I, or strides work, including quality hidden inside an
  easy/long-labeled run and secondary workouts.
- Strides written in the title/description (the generator's current encoding).
  Their isolated distance/time is unknown and is not invented.
- Full ordered segments, repetitions, prescribed paces, recovery segments, and
  `restBetween` in seconds. Recovery metadata is not added a second time to
  explicit recovery segments.
- Session/quality distance, quality minutes, weekly and daily mileage, secondary
  distance, recovery-week status, and days since the previous quality session.
- Week-level findings even when the week has **no** quality sessions.

Ordinary E/recovery runs, all-E long runs and the race itself are filtered out.
Weekly T/I budget checks still consider all non-race workouts. Date/week filters
are applied after the full-plan analysis so prior-session spacing and weekly
budgets retain their context.

## Documentation comparisons

Each finding cites its source. The report compares:

- `elite-training-plan.md`: E/strides base, recovery-week steady-E Q1 and T Q2,
  and retained quality during the final two pre-race taper weeks.
- `training-types-reference.md`: weekly T/I limits, M session limits, T cruise
  repetition/recovery limits, I repetition/recovery limits, and opening warm-up
  and missing cool-down checks. Continuous T blocks are distinct from cruise
  intervals; the 15-minute repetition limit is not applied to continuous tempos.
- `AGENTS.md`: the approved 160-minute long-run extension (the reference says
  150), 25% Q1 distance, 6-mile doubles, ordinary daily load and Q1/Q2 spacing.
- `vdot-training-intensities.md`: reminder when no current race/pace anchor is
  stored; goal-derived zones are not verified current fitness.

The marathon-specific base/recovery/taper checks assume the project's
race-relative 14–28-week schedule and are skipped for explicitly non-marathon
profiles. A legacy profile without `raceDistance` is treated as marathon.
Race-week T work is exempt from the ordinary weekly T percentage cap and cruise
rest check, because the reference explicitly prescribes its own sharpener.

The under-10-minute I-dose flag is a **coaching prompt**, not a documented
minimum. The report does not certify a plan or automatically replace sessions.
Review the ordered sessions against the reference's M/T, T/E/T and steady-E Q1
rotation with complementary Q2 sessions; literal elite distances should be
scaled to the runner. It does not automatically judge the entire rotation,
athlete readiness, fueling, or whether current training paces are achievable.
