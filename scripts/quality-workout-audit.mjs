/** Read-only saved-prescription audit against the documented marathon reference. */
const QUALITY_TYPES = new Set(["marathon_pace", "threshold", "vo2", "strides", "repetition"]);
const ELITE = "docs/elite-training-plan.md";
const LIMITS = "docs/training-types-reference.md";
const round = (value) => Math.round(value * 100) / 100;
const miles = (segment) => (segment.distance ?? 0) * (segment.repetitions ?? 1);
const minutes = (segment) => (segment.duration ?? ((segment.distance ?? 0) * (segment.pace ?? 0))) * (segment.repetitions ?? 1);
const workouts = (day) => [day.workout, day.secondaryWorkout].filter(Boolean);
// The current generator encodes strides in easy-segment prose, not a separate type.
const hasStrides = (workout) => /\bstrides\b/i.test([workout.title, workout.description, ...(workout.segments ?? []).map((segment) => segment.description)].join(" "));
const isQuality = (workout) => workout.type !== "race" && (hasStrides(workout) || (workout.segments ?? []).some((segment) => QUALITY_TYPES.has(segment.type)));
const atType = (workout, type, measure = miles) => (workout.segments ?? []).filter((segment) => segment.type === type).reduce((sum, segment) => sum + measure(segment), 0);

/** Findings are review prompts, not a medical/safety certification or automatic plan edits. */
export function auditQualityWorkouts(plan, { date, week } = {}) {
  const marathon = !plan.runnerProfile?.raceDistance || plan.runnerProfile.raceDistance === "marathon";
  const baseWeeks = Math.max(3, plan.weeks.length - 18);
  const allRows = [];
  const weekReviews = [];
  for (const [index, item] of plan.weeks.entries()) {
    const days = item.days ?? [];
    const all = days.flatMap(workouts).filter((workout) => workout.type !== "race");
    const findings = [];
    const addWeek = (code, message, source) => findings.push({ code, message, source });
    const remaining = plan.weeks.length - index - 1;
    const totalThreshold = all.reduce((sum, workout) => sum + atType(workout, "threshold"), 0);
    const totalThresholdMinutes = all.reduce((sum, workout) => sum + atType(workout, "threshold", minutes), 0);
    const totalIntervals = all.reduce((sum, workout) => sum + atType(workout, "vo2"), 0);
    const hasQuality = all.some((workout) => (workout.segments ?? []).some((segment) => ["marathon_pace", "threshold", "vo2"].includes(segment.type)));
    if (!item.isRaceWeek && (totalThreshold > item.totalMileage * 0.1 + 0.01 || totalThresholdMinutes > 60.01)) {
      addWeek("threshold-budget", "Weekly T exceeds 10% of mileage or 60 minutes.", LIMITS);
    }
    if (totalIntervals > Math.min(item.totalMileage * 0.08, 10 / 1.609344) + 0.01) {
      addWeek("interval-budget", "Weekly I exceeds 8% of mileage or 10 km.", LIMITS);
    }
    if (marathon && index < baseWeeks && all.some((workout) => (workout.segments ?? []).some((segment) => ["threshold", "vo2", "marathon_pace"].includes(segment.type)))) {
      addWeek("base-quality", "Reference base block is E running, adding strides after week 3; sustained M/T/I here is an adaptation.", `${ELITE} — Phase A`);
    }
    if (marathon && index >= 3 && index < baseWeeks && !all.some((workout) => hasStrides(workout) || (workout.segments ?? []).some((segment) => segment.type === "strides" || segment.type === "repetition"))) {
      addWeek("missing-strides", "No prescribed strides found in the latter base block; reference adds them after 2–3 E runs.", `${ELITE} — Phase A`);
    }
    if (marathon && item.isDownWeek) {
      if (all.some((workout) => workout.type === "long" && isQuality(workout))) {
        addWeek("down-week-long-quality", "Recovery-week Q1 contains quality; the reference uses steady E long runs on reduced-volume weeks.", `${ELITE} — weeks 9, 12, 15, 18; AGENTS.md — recovery weeks`);
      }
      if (!totalThreshold) addWeek("down-week-no-threshold", "No scaled threshold Q2 found in this recovery week.", `${ELITE} — weeks 9, 12, 15, 18`);
    }
    if (marathon && !item.isRaceWeek && remaining >= 1 && remaining <= 2 && !hasQuality) {
      addWeek("taper-no-quality", "No M/T/I work in this pre-race taper week; the reference retains reduced Q1/Q2 quality.", `${ELITE} — weeks 22–23`);
    }
    for (const day of days) {
      for (const [slot, workout] of [["primary", day.workout], ["secondary", day.secondaryWorkout]]) {
        if (!workout || !isQuality(workout)) continue;
        const rowFindings = [];
        const add = (code, message, source) => rowFindings.push({ code, message, source });
        const segments = workout.segments ?? [];
        const hard = segments.filter((segment) => QUALITY_TYPES.has(segment.type));
        if (hasStrides(workout) && !hard.some((segment) => segment.type === "strides" || segment.type === "repetition")) add("prose-strides", "Strides prescribed in text only; their distance/time cannot be isolated from easy totals.", "Saved workout prescription");
        const dayMiles = day.plannedMileage ?? workouts(day).reduce((sum, run) => sum + run.totalDistance, 0);
        if (day.secondaryWorkout?.totalDistance > 6.01) add("double-distance", `Secondary run is ${day.secondaryWorkout.totalDistance} mi; current project limit is 6 mi.`, "AGENTS.md — Doubles");
        if (!workouts(day).some((run) => run.type === "long") && dayMiles > Math.max(8, item.totalMileage * 0.2) + 0.01) add("daily-load", `${round(dayMiles)} mi day exceeds current ordinary-day limit of max(8 mi, 20% of weekly mileage).`, "AGENTS.md — ordinary daily load");
        if (workout.type === "long" && (segments.reduce((sum, segment) => sum + minutes(segment), 0) > 160.01 || workout.totalDistance > item.totalMileage * 0.25 + 0.01)) {
          add("long-run-cap", "Long run exceeds 25% of weekly mileage or the approved 160-minute project ceiling (reference: 150 minutes).", `${LIMITS}; AGENTS.md — Q1 cap`);
        }
        const marathonMiles = atType(workout, "marathon_pace");
        if (marathonMiles > 16.01 || atType(workout, "marathon_pace", minutes) > 90.01) add("marathon-cap", "M work exceeds 16 miles or 90 minutes.", LIMITS);
        for (const segment of hard) {
          const repMinutes = minutes(segment) / (segment.repetitions ?? 1);
          if (segment.type === "vo2" && repMinutes > 5.01) add("interval-rep", "I repetition exceeds 5 minutes.", LIMITS);
          if (segment.type === "vo2" && segment.restBetween > repMinutes * 60 + 1) add("interval-rest", "I recovery is longer than its work repetition.", LIMITS);
          if (segment.type === "threshold" && (segment.repetitions ?? 1) > 1) {
            if (repMinutes > 15.01) add("threshold-rep", "T cruise repetition exceeds 15 minutes.", LIMITS);
            if (!item.isRaceWeek && segment.restBetween != null && Math.abs(segment.restBetween - repMinutes * 60 / 5) > 15) add("threshold-rest", "T cruise recovery differs by more than 15 seconds from the reference's one-fifth work time.", LIMITS);
          }
        }
        if (atType(workout, "vo2") > 0 && atType(workout, "vo2", minutes) < 10) add("small-interval-dose", "Less than 10 minutes of I work: review whether this is an intentional maintenance dose. This is a coaching prompt, not a documented minimum.", "Coaching review");
        if (minutes(segments[0] ?? {}) < 10 && !QUALITY_TYPES.has(segments[0]?.type)) add("short-warmup", "Opening easy segment is under the documented 10-minute warm-up minimum.", LIMITS);
        if (QUALITY_TYPES.has(segments.at(-1)?.type)) add("no-cooldown", "No closing easy segment is prescribed; reference lists 10–30 minutes for cool-downs.", LIMITS);
        else if (hard.length && minutes(segments.at(-1) ?? {}) < 10) add("short-cooldown", "Closing easy segment is under the documented 10-minute cool-down minimum.", LIMITS);
        allRows.push({ week: item.weekNumber, date: day.date?.slice(0, 10), day: day.dayOfWeek, slot, id: workout.id,
          title: workout.title, totalMiles: workout.totalDistance, weeklyMiles: item.totalMileage,
          dayMiles, secondaryMiles: day.secondaryWorkout?.totalDistance ?? 0, isDownWeek: !!item.isDownWeek,
          daysSincePreviousQuality: null,
          qualityMiles: round(hard.reduce((sum, segment) => sum + miles(segment), 0)),
          qualityMinutes: round(hard.reduce((sum, segment) => sum + minutes(segment), 0)),
          segments, findings: rowFindings });
      }
    }
    weekReviews.push({ week: item.weekNumber, startDate: item.startDate?.slice(0, 10), weeklyMiles: item.totalMileage, findings });
  }
  allRows.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  let previousKeyDate;
  for (let index = 0; index < allRows.length; index++) {
    const row = allRows[index];
    if (index > 0) row.daysSincePreviousQuality = (Date.parse(row.date) - Date.parse(allRows[index - 1].date)) / 86400000;
    // Relaxed strides may follow a key workout the next day (including race week).
    if (row.segments.some((segment) => ["marathon_pace", "threshold", "vo2"].includes(segment.type))) {
      const gap = (Date.parse(row.date) - Date.parse(previousKeyDate)) / 86400000;
      if (gap < 2) row.findings.push({ code: "quality-spacing", message: `Only ${gap} calendar days since previous M/T/I session.`, source: "AGENTS.md — Q1/Q2 spacing" });
      previousKeyDate = row.date;
    }
  }
  const rows = allRows.filter((row) => (!date || row.date === date) && (week === undefined || row.week === Number(week)));
  const reviews = weekReviews.filter((item) => (week === undefined || item.week === Number(week)) && (!date || plan.weeks.find((w) => w.weekNumber === item.week)?.days.some((d) => d.date?.slice(0, 10) === date)));
  const profile = plan.runnerProfile ?? {};
  const notes = ["Reference session families are scaled, not literal elite mileages. Findings are deviations/review prompts; absence of findings is not full approval.",
    "M/T alternations, T/E/T long runs, steady-E recovery long runs and Q2 threshold/interval work should rotate (elite reference weeks 7–23). Review the listed segments for that progression.",
    "Race and all-E long runs are excluded. Text-prescribed strides are included but not assigned invented quality distance/time. Weekly intensity totals include all non-race workouts. Explicit recovery segments are counted once; restBetween is shown separately, not added again."];
  if (![profile.currentMarathonPR, profile.currentHalfMarathonPR, profile.averageEasyPace, profile.averageMarathonPace, profile.averageThresholdPace].some((value) => Number.isFinite(value) && value > 0)) notes.push("No current race/pace anchor stored: goal-derived training paces are estimates, not verified current VDOT (docs/vdot-training-intensities.md).");
  return { version: "quality-audit-v1", sources: [ELITE, LIMITS, "docs/vdot-training-intensities.md", "AGENTS.md"],
    paceZones: plan.paceZones, notes, sessionCount: rows.length, sessions: rows, weeks: reviews };
}

function pace(value) {
  if (!Number.isFinite(value)) return "unspecified pace";
  const seconds = Math.round(value * 60);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}/mi`;
}

/** Human view keeps every executable segment, including repetitions and recovery metadata. */
export function formatQualityAudit({ raceName, planId, details }) {
  const lines = [`${raceName} — quality-workout audit`, `Plan: ${planId}`, `${details.sessionCount} quality sessions (race and all-E runs excluded)`, "",
    ...details.notes.map((note) => `Note: ${note}`), ""];
  for (const row of details.sessions) {
    lines.push(`W${row.week} ${row.date} ${row.day ?? ""} [${row.slot}] — ${row.title}`,
      `  ${row.totalMiles} mi total | ${row.qualityMiles} mi / ${row.qualityMinutes} min quality | week ${row.weeklyMiles} mi${row.isDownWeek ? " (recovery week)" : ""} | day ${row.dayMiles} mi | secondary ${row.secondaryMiles} mi${row.daysSincePreviousQuality != null ? ` | ${row.daysSincePreviousQuality} days since previous quality` : ""}`);
    for (const segment of row.segments) {
      const size = segment.distance != null ? `${segment.distance} mi` : `${segment.duration ?? "?"} min`;
      lines.push(`  ${segment.repetitions ? `${segment.repetitions} × ` : ""}${size} ${segment.type} @ ${pace(segment.pace)}${segment.restBetween != null ? `; ${segment.restBetween}s between reps` : ""}${segment.description ? ` — ${segment.description}` : ""}`);
    }
    for (const finding of row.findings) lines.push(`  REVIEW [${finding.code}]: ${finding.message} (${finding.source})`);
    lines.push("");
  }
  lines.push("Week-level documentation comparisons (includes weeks with no quality):");
  for (const item of details.weeks) for (const finding of item.findings) lines.push(`  W${item.week} [${finding.code}]: ${finding.message} (${finding.source})`);
  lines.push("", `Sources: ${details.sources.join(", ")}`);
  return lines.join("\n");
}
