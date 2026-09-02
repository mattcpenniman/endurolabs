#!/usr/bin/env node

import postgres from "postgres";

const MILES_PER_METER = 1 / 1609.344;
const MAX_MILEAGE_DIFFERENCE = 0.3;
const MAX_DATE_DIFFERENCE_DAYS = 8;

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function printUsage() {
  console.error(`Usage:
  npm run plan:align-garmin -- --plan-id plan-uuid
  npm run plan:align-garmin -- --email runner@example.com
  npm run plan:align-garmin -- --plan-id plan-uuid --apply
  npm run plan:align-garmin -- --plan-id plan-uuid --json`);
}

function dateKey(value) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

function dayNumber(value) {
  return Math.round(Date.parse(`${dateKey(value)}T00:00:00Z`) / 86400000);
}

function addDays(value, days) {
  return new Date(Date.parse(`${dateKey(value)}T00:00:00Z`) + days * 86400000).toISOString();
}

function workoutMiles(workout) {
  return workout.weeklyMileageContribution || workout.totalDistance || 0;
}

function buildWorkoutLocations(plan) {
  const locations = new Map();
  let order = 0;

  for (const week of plan.weeks) {
    for (const day of week.days) {
      for (const [slot, workout] of [["workout", day.workout], ["secondaryWorkout", day.secondaryWorkout]]) {
        if (workout) locations.set(workout.id, { week, day, slot, workout, order: order++ });
      }
    }
  }

  return locations;
}

// Manual mileage was entered from Garmin and rounded. A minimum-cost assignment
// handles double days without trusting the existing greedy plan matches.
function matchLogsToActivities(logs, activities) {
  const activityColumns = activities.length;
  const columnCount = activityColumns + logs.length;
  const invalidCost = 1_000_000;
  const unmatchedCost = 10_000;
  const costs = logs.map((log, logIndex) => Array.from({ length: columnCount }, (_, columnIndex) => {
    if (columnIndex >= activityColumns) return columnIndex === activityColumns + logIndex ? unmatchedCost : invalidCost;
    const activity = activities[columnIndex];
    const mileageDifference = Math.abs(log.actualMiles - activity.miles);
    const dateDifference = Math.abs(dayNumber(log.date) - dayNumber(activity.localDate));
    if (mileageDifference > MAX_MILEAGE_DIFFERENCE || dateDifference > MAX_DATE_DIFFERENCE_DAYS) return invalidCost;
    return mileageDifference * 1000 + dateDifference * 100;
  }));

  // Hungarian algorithm for a rectangular cost matrix (rows <= columns).
  const potentialRows = Array(logs.length + 1).fill(0);
  const potentialColumns = Array(columnCount + 1).fill(0);
  const rowForColumn = Array(columnCount + 1).fill(0);
  const path = Array(columnCount + 1).fill(0);
  for (let row = 1; row <= logs.length; row += 1) {
    rowForColumn[0] = row;
    let column0 = 0;
    const minimum = Array(columnCount + 1).fill(Infinity);
    const used = Array(columnCount + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = rowForColumn[column0];
      let delta = Infinity;
      let column1 = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (used[column]) continue;
        const current = costs[row0 - 1][column - 1] - potentialRows[row0] - potentialColumns[column];
        if (current < minimum[column]) {
          minimum[column] = current;
          path[column] = column0;
        }
        if (minimum[column] < delta) {
          delta = minimum[column];
          column1 = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (used[column]) {
          potentialRows[rowForColumn[column]] += delta;
          potentialColumns[column] -= delta;
        } else {
          minimum[column] -= delta;
        }
      }
      column0 = column1;
    } while (rowForColumn[column0] !== 0);
    do {
      const column1 = path[column0];
      rowForColumn[column0] = rowForColumn[column1];
      column0 = column1;
    } while (column0 !== 0);
  }

  const matches = [];
  for (let column = 1; column <= activityColumns; column += 1) {
    const row = rowForColumn[column];
    if (row > 0 && costs[row - 1][column - 1] < invalidCost) {
      matches.push({ log: logs[row - 1], activity: activities[column - 1] });
    }
  }
  return matches.sort((left, right) => left.activity.startTimeLocal.localeCompare(right.activity.startTimeLocal));
}

function shiftTrailingWeeks(plan, matches, locations) {
  const shiftsByWeek = new Map();
  for (const { log, activity } of matches) {
    if (log.isAdditionalRun || !log.plannedWorkoutId) continue;
    const location = locations.get(log.plannedWorkoutId);
    if (!location) continue;
    const shift = dayNumber(activity.localDate) - dayNumber(location.day.date);
    if (!shiftsByWeek.has(location.week.weekNumber)) shiftsByWeek.set(location.week.weekNumber, []);
    shiftsByWeek.get(location.week.weekNumber).push(shift);
  }

  const planDates = new Set(plan.weeks.flatMap((week) => week.days.map((day) => dateKey(day.date))));
  const firstMissingTarget = matches.find(({ log, activity }) =>
    !log.isAdditionalRun && log.plannedWorkoutId && !planDates.has(activity.localDate)
  );
  if (!firstMissingTarget) return null;

  const location = locations.get(firstMissingTarget.log.plannedWorkoutId);
  if (!location) return null;
  const shifts = shiftsByWeek.get(location.week.weekNumber) ?? [];
  const shift = shifts[0];
  if (!shift || !shifts.every((candidate) => candidate === shift)) {
    throw new Error(`Week ${location.week.weekNumber} has Garmin runs outside the plan but no consistent date shift`);
  }

  for (const week of plan.weeks.filter((candidate) => candidate.weekNumber >= location.week.weekNumber)) {
    week.startDate = addDays(week.startDate, shift);
    week.endDate = addDays(week.endDate, shift);
    for (const day of week.days) day.date = addDays(day.date, shift);
  }

  for (const phase of plan.phases) {
    const firstWeek = plan.weeks.find((week) => week.weekNumber === phase.weekRange[0]);
    const lastWeek = plan.weeks.find((week) => week.weekNumber === phase.weekRange[1]);
    if (firstWeek) phase.startDate = firstWeek.startDate;
    if (lastWeek) phase.endDate = lastWeek.endDate;
  }

  return { fromWeek: location.week.weekNumber, days: shift };
}

function moveMatchedWorkouts(plan, matches) {
  const locations = buildWorkoutLocations(plan);
  const moves = matches.flatMap(({ log, activity }) => {
    if (log.isAdditionalRun || !log.plannedWorkoutId) return [];
    const location = locations.get(log.plannedWorkoutId);
    if (!location || dateKey(location.day.date) === activity.localDate) return [];
    return [{ ...location, targetDate: activity.localDate, activity, log }];
  });

  for (const move of moves) {
    if (move.day.workout?.id === move.workout.id) move.day.workout = null;
    if (move.day.secondaryWorkout?.id === move.workout.id) move.day.secondaryWorkout = null;
  }
  for (const week of plan.weeks) {
    for (const day of week.days) {
      if (!day.workout && day.secondaryWorkout) {
        day.workout = day.secondaryWorkout;
        day.secondaryWorkout = null;
      }
    }
  }

  for (const move of moves) {
    const target = move.week.days.find((day) => dateKey(day.date) === move.targetDate);
    if (!target) throw new Error(`No day exists for ${move.targetDate} in week ${move.week.weekNumber}`);
    if (!target.workout) target.workout = move.workout;
    else if (!target.secondaryWorkout) target.secondaryWorkout = move.workout;
    else throw new Error(
      `Cannot move ${move.workout.id}: ${move.targetDate} already has ${target.workout.id} and ${target.secondaryWorkout.id}`
    );
  }

  for (const week of plan.weeks) {
    for (const day of week.days) {
      day.plannedMileage = [day.workout, day.secondaryWorkout]
        .filter(Boolean)
        .reduce((total, workout) => total + workoutMiles(workout), 0);
      day.isRestDay = !day.workout && !day.secondaryWorkout;
    }
  }

  return moves;
}

function confidenceFor(workout, activity) {
  const plannedMiles = workoutMiles(workout);
  const differenceRatio = plannedMiles > 0 ? Math.abs(plannedMiles - activity.miles) / plannedMiles : 1;
  return differenceRatio <= 0.1 ? "high" : differenceRatio <= 0.25 ? "medium" : "low";
}

async function loadData(sql, planId, email) {
  const planRows = planId
    ? await sql`select p.id, p.user_id as "userId", p.race_name as "raceName", p.plan_data as "planData" from plans p where p.id = ${planId} limit 1`
    : await sql`select p.id, p.user_id as "userId", p.race_name as "raceName", p.plan_data as "planData" from users u join plans p on p.id = u.current_plan_id where u.email = ${email} limit 1`;
  const planRow = planRows[0];
  if (!planRow) throw new Error("Plan not found");

  const logs = await sql`
    select id, date, planned_workout_id as "plannedWorkoutId",
      is_additional_run = 1 as "isAdditionalRun",
      actual_mileage_hundredths / 100.0 as "actualMiles"
    from plan_run_logs where plan_id = ${planRow.id} and user_id = ${planRow.userId}
  `;
  const activities = await sql`
    select id, provider_activity_id as "providerActivityId", local_date as "localDate",
      start_time_local as "startTimeLocal", distance_meters as "distanceMeters"
    from run_activities
    where user_id = ${planRow.userId} and (plan_id is null or plan_id = ${planRow.id})
    order by start_time_local asc
  `;

  const locations = buildWorkoutLocations(planRow.planData);
  logs.sort((left, right) => {
    const leftOrder = locations.get(left.plannedWorkoutId)?.order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = locations.get(right.plannedWorkoutId)?.order ?? Number.MAX_SAFE_INTEGER;
    return dayNumber(left.date) - dayNumber(right.date) || leftOrder - rightOrder;
  });

  return {
    ...planRow,
    logs: logs.map((log) => ({ ...log, actualMiles: Number(log.actualMiles) })),
    activities: activities.map((activity) => ({
      ...activity,
      miles: Number(activity.distanceMeters) * MILES_PER_METER,
    })),
  };
}

const planId = getArg("plan-id")?.trim();
const email = getArg("email")?.trim().toLowerCase();
const apply = process.argv.includes("--apply");
const asJson = process.argv.includes("--json");

if ((!planId && !email) || (planId && email)) {
  printUsage();
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const sql = postgres(databaseUrl, { prepare: false });

try {
  const data = await loadData(sql, planId, email);
  const plan = structuredClone(data.planData);
  const matches = matchLogsToActivities(data.logs, data.activities);
  const initialLocations = buildWorkoutLocations(plan);
  const weekShift = shiftTrailingWeeks(plan, matches, initialLocations);
  const moves = moveMatchedWorkouts(plan, matches);
  const finalLocations = buildWorkoutLocations(plan);
  const matchedActivityIds = new Set(matches.map(({ activity }) => activity.id));
  const unmatchedActivities = data.activities.filter((activity) => !matchedActivityIds.has(activity.id));
  const plannedMatches = matches.filter(({ log }) => !log.isAdditionalRun && log.plannedWorkoutId);
  const additionalMatches = matches.filter(({ log }) => log.isAdditionalRun);

  const report = {
    planId: data.id,
    raceName: data.raceName,
    mode: apply ? "applied" : "dry-run",
    weekShift,
    movedWorkouts: moves.map((move) => ({
      workoutId: move.workout.id,
      from: dateKey(move.day.date),
      to: move.targetDate,
      activityId: move.activity.providerActivityId,
    })),
    matchedPlannedRuns: plannedMatches.length,
    additionalRuns: additionalMatches.length,
    unmatchedActivities: unmatchedActivities.map((activity) => ({
      activityId: activity.providerActivityId,
      date: activity.localDate,
      miles: Math.round(activity.miles * 100) / 100,
    })),
  };

  if (apply) {
    await sql.begin(async (tx) => {
      await tx`update plans set plan_data = ${tx.json(plan)}, updated_at = now() where id = ${data.id}`;

      for (const { log, activity } of matches) {
        if (log.isAdditionalRun || !log.plannedWorkoutId) {
          await tx`
            update run_activities set plan_id = null, week_number = null, day_of_week = null,
              planned_workout_id = null, match_confidence = null, updated_at = now()
            where id = ${activity.id}
          `;
          continue;
        }

        const location = finalLocations.get(log.plannedWorkoutId);
        if (!location) throw new Error(`Workout ${log.plannedWorkoutId} disappeared while applying changes`);
        await tx`
          update plan_run_logs set date = ${location.day.date}, week_number = ${location.week.weekNumber},
            day_of_week = ${location.day.dayOfWeek}, updated_at = now() where id = ${log.id}
        `;
        await tx`
          update run_activities set plan_id = ${data.id}, week_number = ${location.week.weekNumber},
            day_of_week = ${location.day.dayOfWeek}, planned_workout_id = ${log.plannedWorkoutId},
            match_confidence = ${confidenceFor(location.workout, activity)}, updated_at = now()
          where id = ${activity.id}
        `;
      }

      for (const activity of unmatchedActivities) {
        await tx`
          update run_activities set plan_id = null, week_number = null, day_of_week = null,
            planned_workout_id = null, match_confidence = null, updated_at = now()
          where id = ${activity.id}
        `;
      }
    });
  }

  if (asJson) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`${apply ? "Applied" : "Dry run for"} Garmin alignment on ${data.raceName || data.id}.`);
    if (weekShift) console.log(`Shift trailing schedule: week ${weekShift.fromWeek}+ by ${weekShift.days} days`);
    console.table(report.movedWorkouts);
    console.log(`Matched planned runs: ${report.matchedPlannedRuns}`);
    console.log(`Additional runs left unassigned: ${report.additionalRuns}`);
    console.log(`Unmatched Garmin activities: ${report.unmatchedActivities.length}`);
    if (!apply) console.log("Run again with --apply to persist these changes.");
  }
} finally {
  await sql.end();
}
