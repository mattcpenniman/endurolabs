/**
 * Read-only cycle pace/intensity comparisons. Fixed selected-plan reference zones
 * make cycles comparable; they do not reconstruct historical physiology.
 */
import type { ActivityChartSample } from '@/lib/activities/models';
import { gradeAdjustedSpeed } from '@/lib/analytics/run-score';
import { EFFORT_ZONES, summarizeTimeAtEffort, type EffortZone } from '@/lib/analytics/time-at-effort';
import { predictEquivalentRaceSeconds, type RaceAnalysisActivity } from '@/lib/analytics/race-performance-analysis';
import type { MarathonPlan, WorkoutSegment } from '@/lib/training/models';
import type { PlanHistoryReport, StoredTrainingPlan } from './plan-history';

type ZoneValues = Record<EffortZone, number>;
const empty = (): ZoneValues => ({ recovery: 0, easy: 0, marathon: 0, threshold: 0, vo2: 0 });
const round = (n: number): number => Math.round(n * 10) / 10;
const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const dayBefore = (date: string, days: number): string => new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10);

export interface IntensityDistribution {
  minutes: ZoneValues;
  /** Denominator is all recorded elapsed run time, including missing detail. */
  coverage: number;
  uncoveredMinutes: number;
}
export interface PaceTrace {
  rawSeconds: ZoneValues;
  rawMeters: ZoneValues;
  gapSeconds: ZoneValues;
  gapMeters: ZoneValues;
  hrSeconds: ZoneValues;
  powerSeconds: ZoneValues;
  nearGoalSeconds: number;
  /** Easy/recovery reference GAP paired with measured HR; not HR drift. */
  easyHrSeconds: number;
  easyHrTotal: number;
  measuredPowerSeconds: number;
  measuredPowerTotal: number;
  gapPowerSeconds: ZoneValues;
  gapPowerTotal: ZoneValues;
  longestNearGoalBlock: { minutes: number; actualPace: number | null; gapPace: number | null; averageHr: number | null };
  longestThresholdBlockMinutes: number;
  rawNearGoalSeconds: number;
  longestRawNearGoalBlock: { minutes: number; actualPace: number | null; averageHr: number | null };
}

/** Midpoints of reference pace anchors, not physiological intensity detection. */
export function paceZone(pace: number, plan: MarathonPlan): EffortZone {
  const z = plan.paceZones;
  const easySlow = Math.max(z.easy.min, z.easy.max), easyFast = Math.min(z.easy.min, z.easy.max);
  if (pace >= (z.recovery + easySlow) / 2) return 'recovery';
  if (pace >= (easyFast + z.marathon) / 2) return 'easy';
  if (pace >= (z.marathon + z.threshold) / 2) return 'marathon';
  if (pace >= (z.threshold + z.vo2) / 2) return 'threshold';
  return 'vo2';
}

/** Uses speed × dt distance and >=60 s elevation/speed windows; never sample distance/grade. */
export function analyzePaceTrace(input: {
  samples: ActivityChartSample[]; plan: MarathonPlan; hasMeasuredPower: boolean; goalPace: number;
}): PaceTrace {
  const result: PaceTrace = { rawSeconds: empty(), rawMeters: empty(), gapSeconds: empty(), gapMeters: empty(), hrSeconds: empty(), powerSeconds: empty(),
    nearGoalSeconds: 0, easyHrSeconds: 0, easyHrTotal: 0, measuredPowerSeconds: 0, measuredPowerTotal: 0,
    gapPowerSeconds: empty(), gapPowerTotal: empty(),
    longestNearGoalBlock: { minutes: 0, actualPace: null, gapPace: null, averageHr: null }, longestThresholdBlockMinutes: 0,
    rawNearGoalSeconds: 0, longestRawNearGoalBlock: { minutes: 0, actualPace: null, averageHr: null } };
  const samples = [...input.samples].filter(s => Number.isFinite(s.elapsedSeconds) && s.elapsedSeconds >= 0)
    .sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)
    .filter((s, i, all) => i === 0 || s.elapsedSeconds > all[i - 1].elapsedSeconds);
  // Modeled plan watts are not independent sensor anchors.
  const effort = summarizeTimeAtEffort({ samples, heartRateZones: input.plan.paceZones.heartRateZones,
    powerZones: positive(input.plan.runnerProfile.appleWatchPowerData?.marathonPower) ? input.plan.powerZones : null,
    hasMeasuredPower: input.hasMeasuredPower });
  for (const bucket of effort.heartRate?.buckets ?? []) result.hrSeconds[bucket.zone] = bucket.seconds;
  for (const bucket of effort.power?.buckets ?? []) result.powerSeconds[bucket.zone] = bucket.seconds;
  let start = 0, distance = 0;
  let blockSeconds = 0, blockMeters = 0, blockGapMeters = 0, blockHr = 0, blockHrSeconds = 0, thresholdSeconds = 0;
  let rawBlockSeconds = 0, rawBlockMeters = 0, rawBlockHr = 0, rawBlockHrSeconds = 0;
  const distances = [0];
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], sample = samples[i], dt = sample.elapsedSeconds - before.elapsedSeconds;
    const speed = positive(before.speedMetersPerSecond) && positive(sample.speedMetersPerSecond)
      ? (before.speedMetersPerSecond + sample.speedMetersPerSecond) / 2 : null;
    if (dt <= 0 || dt > 30 || speed === null || speed < 0.5 || speed > 12) {
      start = i; distances[i] = distance; blockSeconds = 0; thresholdSeconds = 0; rawBlockSeconds = 0; continue;
    }
    distance += speed * dt; distances[i] = distance;
    const rawZone = paceZone(1609.344 / speed / 60, input.plan);
    result.rawSeconds[rawZone] += dt; result.rawMeters[rawZone] += speed * dt;
    if (Math.abs((1609.344 / speed / 60) / input.goalPace - 1) <= 0.05) result.rawNearGoalSeconds += dt;
    if (input.hasMeasuredPower && positive(sample.power)) {
      result.measuredPowerSeconds += dt; result.measuredPowerTotal += sample.power * dt;
    }
    while (start + 1 < i && samples[start + 1].elapsedSeconds <= sample.elapsedSeconds - 60) start++;
    const left = samples[start], spanDistance = distance - distances[start], span = sample.elapsedSeconds - left.elapsedSeconds;
    if (span < 60 || spanDistance <= 0) { blockSeconds = 0; thresholdSeconds = 0; rawBlockSeconds = 0; continue; }
    const smoothedSpeed = spanDistance / span;
    if (Math.abs((1609.344 / smoothedSpeed / 60) / input.goalPace - 1) <= 0.05) {
      if (rawBlockSeconds === 0) { rawBlockMeters = 0; rawBlockHr = 0; rawBlockHrSeconds = 0; }
      rawBlockSeconds += dt; rawBlockMeters += speed * dt;
      if (positive(sample.heartRate)) { rawBlockHr += sample.heartRate * dt; rawBlockHrSeconds += dt; }
      if (rawBlockSeconds / 60 > result.longestRawNearGoalBlock.minutes) result.longestRawNearGoalBlock = {
        minutes: rawBlockSeconds / 60, actualPace: rawBlockSeconds / 60 / (rawBlockMeters / 1609.344),
        averageHr: rawBlockHrSeconds ? rawBlockHr / rawBlockHrSeconds : null };
    } else rawBlockSeconds = 0;
    if (!Number.isFinite(left.elevationMeters) || !Number.isFinite(sample.elevationMeters)
      || left.elevationMeters == null || sample.elevationMeters == null) { blockSeconds = 0; thresholdSeconds = 0; continue; }
    const adjusted = gradeAdjustedSpeed(smoothedSpeed, (sample.elevationMeters - left.elevationMeters) / spanDistance);
    if (!positive(adjusted)) { blockSeconds = 0; thresholdSeconds = 0; continue; }
    const pace = 1609.344 / adjusted / 60, zone = paceZone(pace, input.plan);
    result.gapSeconds[zone] += dt; result.gapMeters[zone] += adjusted * dt;
    if (input.hasMeasuredPower && positive(sample.power)) {
      result.gapPowerSeconds[zone] += dt; result.gapPowerTotal[zone] += sample.power * dt;
    }
    if (Math.abs(pace / input.goalPace - 1) <= 0.05) {
      result.nearGoalSeconds += dt;
      if (blockSeconds === 0) { blockMeters = 0; blockGapMeters = 0; blockHr = 0; blockHrSeconds = 0; }
      blockSeconds += dt; blockMeters += speed * dt; blockGapMeters += adjusted * dt;
      if (positive(sample.heartRate)) { blockHr += sample.heartRate * dt; blockHrSeconds += dt; }
      if (blockSeconds / 60 > result.longestNearGoalBlock.minutes) result.longestNearGoalBlock = {
        minutes: blockSeconds / 60, actualPace: blockSeconds / 60 / (blockMeters / 1609.344),
        gapPace: blockSeconds / 60 / (blockGapMeters / 1609.344), averageHr: blockHrSeconds ? blockHr / blockHrSeconds : null };
    } else blockSeconds = 0;
    thresholdSeconds = zone === 'threshold' ? thresholdSeconds + dt : 0;
    result.longestThresholdBlockMinutes = Math.max(result.longestThresholdBlockMinutes, thresholdSeconds / 60);
    if ((zone === 'easy' || zone === 'recovery') && positive(sample.heartRate)) {
      result.easyHrSeconds += dt; result.easyHrTotal += sample.heartRate * dt;
    }
  }
  return result;
}

export interface PrescribedIntensity {
  minutes: ZoneValues;
  unknownMinutes: number;
  totalEstimatedMinutes: number;
}
/** Named work segments, repeated work and between-rep recovery; no workout-title inference. */
export function prescribedIntensity(plan: MarathonPlan, start: string, end: string): PrescribedIntensity {
  const result: PrescribedIntensity = { minutes: empty(), unknownMinutes: 0, totalEstimatedMinutes: 0 };
  for (const day of plan.weeks.flatMap(w => w.days)) {
    const date = day.date.slice(0, 10);
    if (date < start || date >= end || day.isRaceDay) continue;
    for (const workout of [day.workout, day.secondaryWorkout]) {
      if (!workout || ['race', 'rest', 'strength', 'cross_training'].includes(workout.type)) continue;
      result.totalEstimatedMinutes += workout.estimatedDuration;
      const segments: WorkoutSegment[] = workout.segments?.length ? workout.segments
        : [{ type: workout.type, description: workout.title, duration: workout.estimatedDuration }];
      let segmentMinutes = 0;
      for (const s of segments) {
        const zone: EffortZone | null = s.type === 'marathon_pace' ? 'marathon' : s.type === 'long' ? 'easy'
          : EFFORT_ZONES.includes(s.type as EffortZone) ? s.type as EffortZone : null;
        const pace = s.pace ?? (zone === 'easy' ? (plan.paceZones.easy.min + plan.paceZones.easy.max) / 2
          : zone ? plan.paceZones[zone] : null);
        const minutes = (positive(s.duration) ? s.duration : positive(s.distance) && positive(pace) ? s.distance * pace : 0)
          * (s.repetitions ?? 1);
        const recovery = Math.max(0, (s.repetitions ?? 1) - 1) * (s.restBetween ?? 0) / 60;
        segmentMinutes += minutes + recovery;
        if (zone) result.minutes[zone] += minutes;
        else result.unknownMinutes += minutes;
        result.minutes.recovery += recovery;
      }
      // Keep omitted/ambiguous segment time visible rather than labeling it easy.
      result.unknownMinutes += Math.max(0, workout.estimatedDuration - segmentMinutes);
    }
  }
  for (const zone of EFFORT_ZONES) result.minutes[zone] = round(result.minutes[zone]);
  result.unknownMinutes = round(result.unknownMinutes);
  result.totalEstimatedMinutes = round(result.totalEstimatedMinutes);
  return result;
}

export interface ActualPaceWindow {
  start: string; endExclusive: string; observedDays: number; runs: number; miles: number; elapsedHours: number;
  averageWeeklyMiles: number | null; summaryPaceMinutesPerMile: number | null;
  summaryPaceDistanceCoverage: number;
  gap: IntensityDistribution; heartRate: IntensityDistribution; measuredPower: IntensityDistribution;
  rawPace: IntensityDistribution;
  /** Auditable completed runs; raw summary pace is never inferred from plan labels. */
  completedRuns: { id: string; date: string; miles: number; actualMovingPace: number | null; actualElapsedPace: number | null;
    averageHr: number | null; gapCoverage: number; rawSampleDistanceRatio: number; averageGapPace: number | null;
    longestNearGoalBlock: PaceTrace['longestNearGoalBlock'] | null; longestThresholdBlockMinutes: number | null;
    longestRawNearGoalBlock: PaceTrace['longestRawNearGoalBlock'] | null }[];
  gapPaceByZone: Record<EffortZone, number | null>;
  longRuns: number; longRunNearGoalMinutes: number; nearGoalMinutes: number;
  rawNearGoalMinutes: number; longRunRawNearGoalMinutes: number;
  easyReferenceAverageHr: number | null;
  measuredSensorPower: { averageWatts: number | null; coverage: number;
    /** Descriptive watts grouped by GAP pace, not power intensity zones. */
    averageWattsByGapZone: Record<EffortZone, number | null> };
  qualityDays: number; adjacentQualityDayPairs: number;
  peak7DayMiles: number; final21ToPrior21MileageRatio: number | null;
}

function distribution(seconds: ZoneValues, duration: number): IntensityDistribution {
  const total = Object.values(seconds).reduce((a, b) => a + b, 0);
  return { minutes: Object.fromEntries(EFFORT_ZONES.map(z => [z, round(seconds[z] / 60)])) as ZoneValues,
    coverage: duration > 0 ? Math.round(total / duration * 1000) / 1000 : 0,
    uncoveredMinutes: round(Math.max(0, duration - total) / 60) };
}

/** Reject broken moving-time summaries (e.g. 20 miles in seconds); retain valid elapsed fallback. */
function paceDuration(activity: RaceAnalysisActivity, moving: boolean): number | null {
  const valid = (seconds: number | null): seconds is number => positive(seconds)
    && activity.distanceMeters / seconds >= 0.5 && activity.distanceMeters / seconds <= 12;
  if (moving && valid(activity.movingDurationSeconds) && activity.movingDurationSeconds <= activity.durationSeconds * 1.05) return activity.movingDurationSeconds;
  return valid(activity.durationSeconds) ? activity.durationSeconds : null;
}

export function actualPaceWindow(activities: RaceAnalysisActivity[], traces: Map<string, PaceTrace>, start: string, end: string): ActualPaceWindow {
  const runs = activities.filter(a => a.localDate >= start && a.localDate < end && !a.trainingExcluded
    && !a.excludedFromAnalytics && positive(a.durationSeconds) && positive(a.distanceMeters));
  const gap = empty(), hr = empty(), power = empty(), meters = empty();
  const raw = empty();
  const gapPowerTotal = empty(), gapPowerSeconds = empty();
  let measuredPowerSeconds = 0, measuredPowerTotal = 0;
  let duration = 0, distance = 0, moving = 0, paceDistance = 0, near = 0, longNear = 0, easyHr = 0, easySeconds = 0, rawNear = 0, rawLongNear = 0;
  const qualityDates = new Map<string, number>();
  for (const a of runs) {
    duration += a.durationSeconds; distance += a.distanceMeters;
    const validDuration = paceDuration(a, true);
    if (validDuration !== null) { moving += validDuration; paceDistance += a.distanceMeters; }
    const trace = traces.get(a.id); if (!trace) continue;
    for (const z of EFFORT_ZONES) { raw[z] += trace.rawSeconds[z]; gap[z] += trace.gapSeconds[z]; hr[z] += trace.hrSeconds[z];
      power[z] += trace.powerSeconds[z]; meters[z] += trace.gapMeters[z];
      gapPowerTotal[z] += trace.gapPowerTotal[z]; gapPowerSeconds[z] += trace.gapPowerSeconds[z]; }
    measuredPowerSeconds += trace.measuredPowerSeconds; measuredPowerTotal += trace.measuredPowerTotal;
    near += trace.nearGoalSeconds;
    rawNear += trace.rawNearGoalSeconds;
    if (a.distanceMeters / 1609.344 >= 14) rawLongNear += trace.rawNearGoalSeconds;
    if (a.distanceMeters / 1609.344 >= 14) longNear += trace.nearGoalSeconds;
    easyHr += trace.easyHrTotal; easySeconds += trace.easyHrSeconds;
    qualityDates.set(a.localDate, (qualityDates.get(a.localDate) ?? 0)
      + trace.gapSeconds.marathon + trace.gapSeconds.threshold + trace.gapSeconds.vo2);
  }
  const days = [...qualityDates].filter(([, seconds]) => seconds >= 600).map(([date]) => date);
  const milesBetween = (s: string, e: string): number => runs.filter(a => a.localDate >= s && a.localDate < e)
    .reduce((sum, a) => sum + a.distanceMeters / 1609.344, 0);
  const prior = milesBetween(dayBefore(end, 42), dayBefore(end, 21));
  const span = Math.max(0, (Date.parse(end) - Date.parse(start)) / 86400000);
  return { start, endExclusive: end, observedDays: span, runs: runs.length, miles: round(distance / 1609.344), elapsedHours: round(duration / 3600),
    averageWeeklyMiles: span > 0 ? round(distance / 1609.344 / (span / 7)) : null,
    summaryPaceMinutesPerMile: paceDistance > 0 ? moving / 60 / (paceDistance / 1609.344) : null,
    summaryPaceDistanceCoverage: distance > 0 ? paceDistance / distance : 0,
    gap: distribution(gap, duration), heartRate: distribution(hr, duration), measuredPower: distribution(power, duration),
    rawPace: distribution(raw, duration),
    completedRuns: runs.map(a => {
      const trace = traces.get(a.id);
      const seconds = trace ? Object.values(trace.gapSeconds).reduce((sum, n) => sum + n, 0) : 0;
      const gapMeters = trace ? Object.values(trace.gapMeters).reduce((sum, n) => sum + n, 0) : 0;
      const rawMeters = trace ? Object.values(trace.rawMeters).reduce((sum, n) => sum + n, 0) : 0;
      return { id: a.id, date: a.localDate, miles: round(a.distanceMeters / 1609.344),
        actualMovingPace: paceDuration(a, true) !== null ? paceDuration(a, true)! / 60 / (a.distanceMeters / 1609.344) : null,
        actualElapsedPace: paceDuration(a, false) !== null ? paceDuration(a, false)! / 60 / (a.distanceMeters / 1609.344) : null, averageHr: a.averageHeartRate,
        gapCoverage: seconds / a.durationSeconds, rawSampleDistanceRatio: rawMeters / a.distanceMeters,
        averageGapPace: gapMeters > 0 ? seconds / 60 / (gapMeters / 1609.344) : null,
        longestNearGoalBlock: trace && seconds > 0 ? trace.longestNearGoalBlock : null,
        longestThresholdBlockMinutes: trace && seconds > 0 ? trace.longestThresholdBlockMinutes : null,
        longestRawNearGoalBlock: trace && Object.values(trace.rawSeconds).some(n => n > 0) ? trace.longestRawNearGoalBlock : null };
    }),
    gapPaceByZone: Object.fromEntries(EFFORT_ZONES.map(z => [z, meters[z] > 0 ? gap[z] / 60 / (meters[z] / 1609.344) : null])) as Record<EffortZone, number | null>,
    nearGoalMinutes: round(near / 60), longRunNearGoalMinutes: round(longNear / 60),
    rawNearGoalMinutes: round(rawNear / 60), longRunRawNearGoalMinutes: round(rawLongNear / 60),
    longRuns: runs.filter(a => a.distanceMeters >= 14 * 1609.344).length,
    easyReferenceAverageHr: easySeconds ? round(easyHr / easySeconds) : null,
    measuredSensorPower: { averageWatts: measuredPowerSeconds ? round(measuredPowerTotal / measuredPowerSeconds) : null,
      coverage: duration > 0 ? Math.round(measuredPowerSeconds / duration * 1000) / 1000 : 0,
      averageWattsByGapZone: Object.fromEntries(EFFORT_ZONES.map(z => [z, gapPowerSeconds[z] ? round(gapPowerTotal[z] / gapPowerSeconds[z]) : null])) as Record<EffortZone, number | null> },
    qualityDays: days.length, adjacentQualityDayPairs: days.filter(d => days.includes(dayBefore(d, 1))).length,
    peak7DayMiles: round(Math.max(0, ...runs.map(a => milesBetween(dayBefore(a.localDate, 6), dayBefore(a.localDate, -1))))),
    final21ToPrior21MileageRatio: span >= 42 && prior > 0 ? Math.round(milesBetween(dayBefore(end, 21), end) / prior * 1000) / 1000 : null };
}

export interface PaceHistoryReport {
  version: 'pace-history-v1'; asOf: string; reference: {
    planId: string; paceZones: MarathonPlan['paceZones']; powerZones: MarathonPlan['powerZones'] | null;
    goalPace: number; powerAnchored: boolean;
  };
  cycles: { planId: string; raceName: string; raceDate: string; role: string;
    prescribedFinal112: PrescribedIntensity; prescribedObservedWindow: PrescribedIntensity;
    actual: ActualPaceWindow; result: PlanHistoryReport['current']['result'];
    speedBenchmarks: { id: string; date: string; distanceMeters: number; seconds: number;
      equivalentMarathonSeconds: number; source: string }[] }[];
  recent: ActualPaceWindow;
  interpretation: string[];
  recommendations: string[];
}

export function buildPaceHistory(input: {
  history: PlanHistoryReport; plans: StoredTrainingPlan[]; activities: RaceAnalysisActivity[]; traces: Map<string, PaceTrace>; reference: StoredTrainingPlan;
}): PaceHistoryReport {
  const { history, reference, activities, traces } = input;
  const anchored = positive(reference.plan.runnerProfile.appleWatchPowerData?.marathonPower);
  const best = history.cycles.find(c => c.planId === history.bestCycleId);
  const recentRaces = activities.filter(a => a.eventType === 'race' && !a.excludedFromAnalytics
    && a.localDate >= dayBefore(history.asOf, 365) && a.localDate < history.asOf
    && a.distanceMeters >= 4500 && a.distanceMeters <= 22000 && positive(a.durationSeconds));
  const equivalents = recentRaces.map(a => predictEquivalentRaceSeconds(a.durationSeconds, a.distanceMeters, 42195));
  const bestEquivalent = equivalents.length ? Math.min(...equivalents) : null;
  const latest = history.cycles[history.cycles.length - 1];
  const latestActual = latest ? actualPaceWindow(activities, traces, dayBefore(latest.raceDate, 112), latest.raceDate) : null;
  return { version: 'pace-history-v1', asOf: history.asOf,
    reference: { planId: reference.id, paceZones: reference.plan.paceZones, powerZones: anchored ? reference.plan.powerZones ?? null : null,
      goalPace: history.goalPaceMinutesPerMile, powerAnchored: anchored },
    cycles: [...history.cycles, history.current, ...history.alternatives].map(c => {
      const plan = input.plans.find(p => p.id === c.planId)?.plan;
      if (!plan) throw new Error(`Missing cycle plan ${c.planId}`);
      const start = dayBefore(c.raceDate, 112), end = c.raceDate < history.asOf ? c.raceDate : history.asOf;
      return { planId: c.planId, raceName: c.raceName, raceDate: c.raceDate,
        role: c.planId === reference.id ? 'selected' : c.raceDate === history.current.raceDate ? 'draft' : 'past',
        prescribedFinal112: prescribedIntensity(plan, start, c.raceDate),
        prescribedObservedWindow: prescribedIntensity(plan, start, end),
        actual: actualPaceWindow(activities, traces, start, end), result: c.result,
        speedBenchmarks: activities.filter(a => a.eventType === 'race' && !a.excludedFromAnalytics
          && a.localDate >= dayBefore(end, 365) && a.localDate < end && a.distanceMeters >= 4500
          && a.distanceMeters <= 22000 && positive(a.durationSeconds)).map(a => ({ id: a.id, date: a.localDate,
          distanceMeters: a.distanceMeters, seconds: a.durationSeconds, source: a.resultSource ?? 'garmin',
          equivalentMarathonSeconds: Math.round(predictEquivalentRaceSeconds(a.durationSeconds, a.distanceMeters, 42195)) })) };
    }),
    recent: actualPaceWindow(activities, traces, dayBefore(history.asOf, 112), history.asOf),
    recommendations: [
      bestEquivalent === null ? 'Speed reserve is unassessed: no eligible prior-year 5K–half result. Use a tune-up race before assuming a VO2 deficit.'
        : `Best prior-year short-race marathon equivalent is ${Math.round(bestEquivalent)} seconds versus goal ${Math.round(history.goalMinutes * 60)} seconds. ${bestEquivalent > history.goalMinutes * 60 ? 'Sub-3 speed reserve is not yet demonstrated; develop controlled threshold work and reassess with a tune-up race.' : 'Short-race speed is compatible with the goal, but does not establish marathon durability.'}`,
      ...(latest && latestActual ? [`Latest cycle (${latest.raceName}): ${latestActual.longRunRawNearGoalMinutes} recorded minutes within ±5% of goal pace across ${latestActual.longRuns} runs >=14 miles, with ${(latestActual.rawPace.coverage * 100).toFixed(1)}% raw sample coverage. Review actual long-run pace blocks for specificity; neither total long-run distance nor prescribed marathon labels prove goal-pace practice.`] : []),
      `Treat lower-volume/higher-quality as a monitored tradeoff, not an established improvement.${best ? ` Fastest matched cycle (${best.raceName}) averaged ${best.actualFinal16Weeks.averageWeeklyMiles} mi/week; selected plan schedules ${history.current.plannedFinal16Weeks.averageWeeklyMiles}.` : ''} Build from recent actual mileage; do not jump to a historical peak or make easy days faster.`,
      'Protect one controlled threshold session and selected marathon-effort long-run blocks, separated by easy/recovery days. Replace easy mileage rather than stacking new quality on the existing load; start at demonstrated fitness, not aspirational goal pace.',
      `${history.cycles.filter(c => c.result?.execution === 'blow_up' || c.result?.execution === 'positive_split').length} matched cycles have late-fade execution labels. Rehearse fueling, fluids and a controlled opening pace; inspect continuous blocks/laps before treating accumulated near-goal minutes as completed marathon workouts.`,
      'Before a larger volume cut, track 2–3 weeks of workout completion, repeatable easy-route HR/pace, soreness and sleep. If recovery or quality deteriorates, remove optional doubles/easy mileage first and reassess; volume ratios and quality-day adjacency alone cannot diagnose fatigue.',
      'Use a tune-up half and repeatable fueled long runs before the taper to reassess speed and durability. Maintain down weeks and taper; abandon catch-up miles. No saved plan is changed by this report.',
    ],
    interpretation: [
      'All actual windows are race-relative final 112 days, cut strictly before as-of and race day. A future window can have zero observed days; use recent for current fitness context.',
      'Actual runs include tune-up races and unlinked activities, exclude analytics-excluded rows and canonical duplicate results. Missing/manual-only runs are not reconstructed.',
      'Prescribed zones use named segments and estimated times (distance × prescribed pace when needed), including repeated recovery. They are intent, not proof of completed intensity; historical schedules are mutable.',
      'Segment-derived minutes and workout estimatedDuration can differ; unknown minutes retain unallocated estimated time. They are not forced to agree or scaled into a completion percentage.',
      'GAP, HR and measured-power distributions are separate views of the same time: never add them together. Coverage divides classified seconds by all recorded elapsed time, not only available samples.',
      'All actual cycles use the selected plan reference zones printed above. Midpoint GAP pace bins are descriptive, not lactate thresholds; changing fitness, HR anchors, heat, terrain and devices limit cross-cycle comparisons.',
      'Minetti GAP uses >=60-second elevation/speed windows, skips pauses, gaps >30 seconds and slopes >20%; equivalent flat distance is modeled in memory. GPS/elevation error remains. No sample distance or grade columns are used.',
      'Power requires measured sensor samples and explicit runner-anchored reference watts. Modeled summary/sample power and pace-derived watt anchors are never intensity evidence here.',
      'Measured sensor averages and watts by GAP pace bin remain available without power-zone anchors. They are descriptive sensor observations, not independently calibrated power zones; source/device changes limit comparisons.',
      'Near-goal time means GAP within ±5% of goal pace. Per-run longestNearGoalBlock requires consecutive valid intervals in that band and reports actual raw pace, GAP and HR; brief excursions break blocks, so these are conservative sensor-defined blocks, not detected workout laps. Long runs are >=14 miles.',
      'Raw summary paces use provider distance and moving duration (elapsed when absent); elapsed pace is also reported per completed run. Sample raw pace bins use speed alone; GAP bins adjust for terrain. Neither uses prescribed workout labels to classify actual runs.',
      'Summary pace rejects implausible speeds outside 0.5–12 m/s and moving time longer than elapsed (+5% tolerance); valid elapsed time is the fallback. summaryPaceDistanceCoverage exposes missing/invalid summary pace distance.',
      'Per-run rawSampleDistanceRatio compares the speed×time integral with provider distance; a low ratio may reflect missing trace and a high/low ratio with high time coverage may indicate sensor disagreement. Provider distance remains authoritative for run distance.',
      'Raw sustained near-goal blocks use a trailing >=60-second speed average within ±5% of goal to reduce GPS jitter, and report unsmoothed actual block pace; they do not require elevation. Raw accumulated near-goal minutes use unsmoothed intervals. GAP-only near-goal time may reflect short hills/noisy elevation and must not be called actual marathon-pace work.',
      'Quality days mean >=10 minutes at reference marathon-or-faster GAP, including races; adjacency is a load flag, not a fatigue diagnosis.',
      'Final21/prior21 volume and easy-reference HR are descriptive only; HR drift, sleep, soreness, fueling, weather and workout completion are needed to diagnose fatigue. Faster easy running or more VO2 work is not implied.',
      'Prior-year 5K–half race equivalents test speed reserve only (Riegel); they cannot establish marathon durability. No causal benefit for lower volume/higher quality or goal probability is estimated.',
    ] };
}
