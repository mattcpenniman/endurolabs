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

## Newport 2027 generator follow-up (VEC-1099, 2026-10-25)

Compared saved plan `d953d707-5428-4cd8-9fa9-3b30627eb36a` using the CLI above
with `auditQualityWorkouts(generatePlan(saved.runnerProfile))` in memory. The
stored profile is a 24-week Saturday-race plan (2027-04-17), 48 current/80 peak
mpw, six training days, eight runs, Wednesday rest, Saturday long run, and
Monday/Tuesday doubles, with a 2:59:59 goal and no current race/pace anchors.
No saved plan or referenced workout IDs were changed.

### Findings already fixed before this follow-up

| Area | Saved prescriptions | Fresh generation |
| --- | --- | --- |
| Base | Sustained M/T in weeks 4–6 | Six E weeks, relaxed strides after week 3 |
| Q1/Q2 | Midweek M/T, no T/E/T long family | Long-slot M/T → T/E/T → steady E; complementary T/I Q2 |
| Recovery | Weeks 9/12/15/18: 38–45 min M finishes, no T Q2 | Steady-E Q1 plus 3 × 1 mi T (3 × 1.25 mi in week 15) |
| Taper | No quality weeks 22/23; 16 days to sharpener | Reduced M/T Q1 + T Q2 in week 22, T/E/T Q1 + T Q2 in week 23; two days from final Q1 to sharpener |
| Intervals | Weeks 11/14/17/20: 2 × 0.75 mi, 9.14 min I, 8.1-min E bookends | Weeks 8/11/14/17/20: 4 × 0.75 mi, 18.27 min I, 10.13-min E bookends; week 21: 3 × 0.75 mi |
| Oversized days/doubles | Midweek 17.5–18.75 mi quality days; 7.25–8.25 mi secondary runs | M/T moved into Q1; ordinary-day redistribution and easy doubles ≤6 mi |
| Race week | Appropriate five-day T sharpener, but 1.75 mi closing E | Monday 2027-04-12: 4 × 0.75 mi T, 2-min jogs, 2 mi E on each side |

The interval plateau is now a deliberate consequence of volume-based dosing and
whole repetitions: 64–72 mpw at a 5% I request gives the same four 0.75-mile
reps after rounding down, with three reps at 56 mpw. It is not forced to grow
each cycle. A smaller 1.5-mile I request can still produce two reps; the audit's
under-ten-minute prompt is not a minimum to enforce.

### Remaining defects corrected here

- Floor the ordinary-day ceiling to quarter miles rather than rounding up.
  The previous fresh generator could schedule 11.25 mi against an 11.2-mi limit
  (56 mpw), or 14.5 mi against 14.4 (72 mpw), including easy days omitted from
  the quality-only report. Redistribution still preserves Newport's weekly
  volume; constrained schedules rebuild at feasible volume.
- Give recovery-week policy priority over an I slot in the race-relative
  rotation. In compressed/extended plans the mileage recovery cycle can land
  on an interval week; Q2 now remains scaled T.
- Preserve closing E when an M-family long run has no requested T inserts.
  This branch now places M between easy bookends instead of using an MP finish.
  The old progression-run template is no longer selected by the generator;
  it is not reintroduced to address the saved progression finishes.

After these fixes the fresh audit has **40 quality-containing runs**: 30 M/T/I
sessions and 10 prose-stride runs. No week-level findings remain; the only
session prompts are `prose-strides`. Strides remain text-prescribed, with no
invented isolated time/distance. Both standalone T/I bookends meet the 10–30
minute guidance for this profile. The pace zones remain unchanged and
goal-derived estimates (E midpoint 8:06/mi, M 6:52, T 6:28, I 6:05); no
historical PR is injected.

### Documented adaptations and regression coverage

The elite distances are scaled, continuous/ladders T are adapted to capped
cruise work, and R work is not synthesized as I. Week 21 uses an I-only Q2
adaptation of the mixed reference. Q1 keeps the approved **160-minute actual
segment-time** ceiling rather than the reference's 150 minutes, with its 25%
weekly distance limit. T shares the 10%/60-min budget across Q1/Q2, M stays
within 16 mi/90 min, and I within 8%/10 km with reps ≤5 min and jogs no longer
than work. Race-week 4 × 0.75 mi approximates the documented 4 × 1,200 m;
its explicit 2-min rests and percentage-cap exception are retained.

`src/test/marathon-sessions.test.ts` reproduces the fresh profile audit and
tests shifted recovery cycles (14/18/24/28 weeks), exact daily ceilings and
intensity budgets with constrained schedules/doubles, intentional small I
doses, M-only bookends, base/build/taper families, Saturday race week,
segment-duration limits, and mileage arithmetic. Run:

```sh
npm test -- src/test/marathon-sessions.test.ts src/test/plan-generator.test.ts src/test/zone-calculator.test.ts src/test/quality-workout-audit.test.ts
npx tsc --noEmit
```

## Saved Newport 2027 regeneration (VEC-1104, 2026-10-25)

After PR #53 merged (`c589feaa5632bd330da82dbda3bd2fbf10e979a4`), the runner
explicitly requested applying the updated generator to the saved 2027 plan.
Regeneration was applied at **2026-10-25 13:47 UTC** to the same plan ID,
`d953d707-5428-4cd8-9fa9-3b30627eb36a`; it remains the athlete's current plan.

- Used the exact saved runner profile. Goal, race date, mileage settings,
  training days, rest day, doubles, pace provenance and calendar are preserved.
  The 24 weeks still span 2026-11-02 through 2027-04-18, with race day April 17.
- Confirmed zero linked activities, run logs and Garmin workout exports before
  replacement. Saved a restricted local before-image and updated only
  `plan_data` plus `updated_at` in a row-locked transaction, using `sql.json()`.
  Verified the returned JSON against the serialized generated payload.
- Weeks 1–23 retain their weekly totals. Race-week training mileage changes
  from 17.25 to 17.5 mi due to the corrected closing E segment; the race remains
  excluded from that training total.
- An independent post-commit `plan:details --quality --json` read of the saved
  plan confirms 40 quality-containing runs, no week-level findings, and only
  informational `prose-strides` session prompts. The Monday April 12 sharpener
  is 4 × 0.75 mi T with 2-min jogs and 2 mi E on each side.

This is an applied database operation; the accompanying documentation PR
records the operation and does not need to merge for the saved plan to update.
