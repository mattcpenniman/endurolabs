#!/usr/bin/env node

import { randomUUID } from "crypto";
import postgres from "postgres";

const METERS_PER_MILE = 1609.344;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function printUsage() {
  console.error(`Usage:
  npm run plan:create-from-garmin -- --email runner@example.com --analyze [--start YYYY-MM-DD --end YYYY-MM-DD]
  npm run plan:create-from-garmin -- --email runner@example.com --start YYYY-MM-DD --end YYYY-MM-DD --race-date YYYY-MM-DD --name "Race name"
  npm run plan:create-from-garmin -- --email runner@example.com --start YYYY-MM-DD --end YYYY-MM-DD --race-date YYYY-MM-DD --name "Race name" --apply`);
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isoDate(value) {
  return new Date(`${value}T00:00:00Z`).toISOString();
}

function addDays(value, days) {
  return new Date(Date.parse(`${value.slice(0, 10)}T00:00:00Z`) + days * 86400000).toISOString();
}

function round(value, places = 2) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function dateKey(value) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

async function analyzeHistory(sql, userId, start, end) {
  const activities = await sql`
    select local_date as "localDate", activity_name as "activityName",
      distance_meters as "distanceMeters"
    from run_activities
    where user_id = ${userId}
      and (${start ?? null}::date is null or local_date::date >= ${start ?? null}::date)
      and (${end ?? null}::date is null or local_date::date <= ${end ?? null}::date)
    order by local_date asc
  `;
  if (activities.length === 0) throw new Error("No Garmin runs found in the requested date range");

  const weekly = new Map();
  const raceCandidates = [];
  for (const activity of activities) {
    const activityDate = dateKey(activity.localDate);
    const activityDay = new Date(`${activityDate}T00:00:00Z`);
    const daysSinceMonday = (activityDay.getUTCDay() + 6) % 7;
    const weekStart = addDays(activityDate, -daysSinceMonday).slice(0, 10);
    const miles = Number(activity.distanceMeters) / METERS_PER_MILE;
    const summary = weekly.get(weekStart) ?? { runs: 0, miles: 0, longest: 0, races: [] };
    summary.runs += 1;
    summary.miles += miles;
    summary.longest = Math.max(summary.longest, miles);
    if (miles >= 25) {
      summary.races.push(activity.activityName);
      raceCandidates.push({ date: activityDate, name: activity.activityName, miles: round(miles) });
    }
    weekly.set(weekStart, summary);
  }

  const firstWeek = [...weekly.keys()][0];
  const lastWeek = [...weekly.keys()].at(-1);
  const rows = [];
  let previousMiles = null;
  for (let weekStart = firstWeek; weekStart <= lastWeek; weekStart = addDays(weekStart, 7).slice(0, 10)) {
    const summary = weekly.get(weekStart) ?? { runs: 0, miles: 0, longest: 0, races: [] };
    const miles = round(summary.miles, 1);
    rows.push({
      week: weekStart,
      runs: summary.runs,
      miles,
      change: previousMiles === null ? "" : round(miles - previousMiles, 1),
      longest: round(summary.longest, 1),
      race: summary.races.join(", "),
    });
    previousMiles = miles;
  }

  console.table(rows);
  if (raceCandidates.length > 0) {
    console.log("Marathon-distance race candidates:");
    console.table(raceCandidates);
  }
}

function workoutType(date, raceDate, miles, name) {
  const normalizedName = name.toLowerCase();
  if (date === raceDate) return "marathon_pace";
  if (normalizedName.includes("vo2") || normalizedName.includes("interval")) return "vo2";
  if (normalizedName.includes("threshold") || normalizedName.includes("tempo")) return "threshold";
  if (miles >= 14) return "long";
  if (miles <= 4) return "recovery";
  return "easy";
}

function makeWorkout(activities, date, raceDate, raceName, suffix) {
  const miles = round(activities.reduce((sum, activity) => sum + activity.distanceMeters / METERS_PER_MILE, 0));
  const durationMinutes = round(activities.reduce((sum, activity) => sum + activity.durationSeconds, 0) / 60, 1);
  const combined = activities.length > 1;
  const type = workoutType(date, raceDate, miles, activities.map((activity) => activity.activityName).join(" "));
  const title = date === raceDate
    ? `${raceName} - ${miles} mi`
    : combined
      ? `${miles} mi total (${activities.length} Garmin runs)`
      : `${miles} mi ${type === "long" ? "Long Run" : type === "recovery" ? "Recovery Run" : "Run"}`;

  return {
    workout: {
      id: `garmin-history-${date}-${suffix}`,
      type,
      title,
      description: combined
        ? `Combined historical Garmin activities recorded on ${date}.`
        : `Historical Garmin activity: ${activities[0].activityName}.`,
      segments: [{ description: title, distance: miles, duration: durationMinutes, type }],
      totalDistance: miles,
      estimatedDuration: durationMinutes,
      weeklyMileageContribution: miles,
      intensityCategory: ["vo2", "threshold", "marathon_pace"].includes(type) ? "hard" : "easy",
    },
    activities,
  };
}

function phaseForWeek(weekNumber, totalWeeks) {
  if (weekNumber <= 8) return "base";
  if (weekNumber <= totalWeeks - 5) return "marathon_build";
  return "peak_taper";
}

function makePlan(planId, template, activities, start, end, raceDate, raceName) {
  const activitiesByDate = new Map();
  for (const activity of activities) {
    if (!activitiesByDate.has(activity.localDate)) activitiesByDate.set(activity.localDate, []);
    activitiesByDate.get(activity.localDate).push(activity);
  }

  const totalDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  const totalWeeks = totalDays / 7;
  if (!Number.isInteger(totalWeeks)) throw new Error("Historical plan range must contain complete weeks");
  const assignments = [];
  const weeks = [];
  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const weekNumber = weekIndex + 1;
    const weekStart = addDays(start, weekIndex * 7);
    const days = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = addDays(weekStart, dayIndex);
      const key = date.slice(0, 10);
      const dayActivities = activitiesByDate.get(key) ?? [];
      const groups = dayActivities.length > 2
        ? [dayActivities]
        : dayActivities.map((activity) => [activity]);
      const workoutGroups = groups.map((group, index) => makeWorkout(group, key, raceDate, raceName, index + 1));
      for (const group of workoutGroups) {
        for (const activity of group.activities) {
          assignments.push({
            activityId: activity.id,
            workoutId: group.workout.id,
            weekNumber,
            dayOfWeek: DAY_NAMES[new Date(`${key}T00:00:00Z`).getUTCDay()],
            confidence: group.activities.length === 1 ? "high" : "medium",
          });
        }
      }
      const plannedMileage = round(workoutGroups.reduce((sum, group) => sum + group.workout.totalDistance, 0));
      days.push({
        date,
        dayOfWeek: DAY_NAMES[new Date(`${key}T00:00:00Z`).getUTCDay()],
        workout: workoutGroups[0]?.workout ?? null,
        secondaryWorkout: workoutGroups[1]?.workout ?? null,
        isRestDay: workoutGroups.length === 0,
        plannedMileage,
      });
    }

    const workouts = days.flatMap((day) => [day.workout, day.secondaryWorkout]).filter(Boolean);
    const totalMileage = round(days.reduce((sum, day) => sum + day.plannedMileage, 0));
    const intensityDistribution = { easy: 0, threshold: 0, marathon: 0, vo2: 0 };
    for (const workout of workouts) {
      const bucket = workout.type === "threshold"
        ? "threshold"
        : workout.type === "marathon_pace"
          ? "marathon"
          : workout.type === "vo2"
            ? "vo2"
            : "easy";
      intensityDistribution[bucket] = round(intensityDistribution[bucket] + workout.totalDistance);
    }
    weeks.push({
      weekNumber,
      startDate: weekStart,
      endDate: addDays(weekStart, 6),
      phase: phaseForWeek(weekNumber, totalWeeks),
      days,
      totalMileage,
      calculatedMileage: totalMileage,
      isDownWeek: weekIndex > 0 && totalMileage < weeks[weekIndex - 1].totalMileage * 0.85,
      longRunDistance: round(Math.max(0, ...workouts.filter((workout) => workout.type === "long").map((workout) => workout.totalDistance))),
      intensityDistribution,
    });
  }

  const phaseDefinitions = [
    { phase: "base", name: "Historical Base", description: "Observed aerobic base mileage from Garmin.", focus: "Aerobic volume" },
    { phase: "marathon_build", name: "Historical Marathon Build", description: "Observed peak-volume marathon build from Garmin.", focus: "Volume and durability" },
    { phase: "peak_taper", name: "Historical Taper + Race", description: `Observed taper and ${raceName} race week from Garmin.`, focus: "Taper and race" },
  ];
  const phases = phaseDefinitions.map((definition, index) => {
    const phaseWeeks = weeks.filter((week) => week.phase === definition.phase);
    return {
      phaseNumber: index + 1,
      name: definition.name,
      description: definition.description,
      focus: definition.focus,
      targetMileage: `${Math.min(...phaseWeeks.map((week) => week.totalMileage))}-${Math.max(...phaseWeeks.map((week) => week.totalMileage))} mpw observed`,
      longRunRange: `${Math.min(...phaseWeeks.map((week) => week.longRunDistance))}-${Math.max(...phaseWeeks.map((week) => week.longRunDistance))} miles observed`,
      startDate: phaseWeeks[0].startDate,
      endDate: phaseWeeks.at(-1).endDate,
      weekRange: [phaseWeeks[0].weekNumber, phaseWeeks.at(-1).weekNumber],
    };
  });
  const peakWeeklyMileage = Math.max(...weeks.map((week) => week.totalMileage));
  const runnerProfile = {
    ...template.runnerProfile,
    raceDate,
    raceName,
    weeksOverride: totalWeeks,
    peakMileageOverride: Math.ceil(peakWeeklyMileage),
    currentWeeklyMileage: Math.round(weeks[0].totalMileage),
    peakHistoricalWeeklyMileage: Math.ceil(peakWeeklyMileage),
  };

  return {
    plan: {
      ...template,
      id: planId,
      runnerProfile,
      weeks,
      phases,
      totalWeeks,
      peakWeeklyMileage,
      raceDay: raceDate,
      generatedAt: new Date().toISOString(),
      goalAssessment: {
        feasibility: "realistic",
        reasoning: "Historical plan reconstructed from recorded Garmin mileage.",
        recommendedPeakMileage: Math.ceil(peakWeeklyMileage),
        keyFactors: ["Actual Garmin mileage", "Observed long-run progression", `Completed ${raceName}`],
        timeline: `${totalWeeks} observed training weeks`,
      },
      adjustmentRules: [],
      riskWarnings: peakWeeklyMileage >= 100 ? ["Observed peak mileage exceeded 100 miles per week."] : [],
    },
    runnerProfile,
    assignments,
    weeks,
  };
}

const email = getArg("email")?.trim().toLowerCase();
const start = getArg("start");
const end = getArg("end");
const raceDate = getArg("race-date");
const raceName = getArg("name")?.trim();
const apply = process.argv.includes("--apply");
const analyze = process.argv.includes("--analyze");
const invalidAnalysisRange = analyze && (
  Boolean(start) !== Boolean(end)
  || (start && (!isDate(start) || !isDate(end) || start > end))
);
if (!email || invalidAnalysisRange || (!analyze && (!isDate(start) || !isDate(end) || !isDate(raceDate) || !raceName || start > raceDate || raceDate > end))) {
  printUsage();
  process.exit(1);
}
if (!analyze && (new Date(`${start}T00:00:00Z`).getUTCDay() !== 1 || new Date(`${end}T00:00:00Z`).getUTCDay() !== 0)) {
  throw new Error("Historical plans must start on Monday and end on Sunday");
}

const sql = postgres(process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab", { prepare: false });
try {
  const [user] = await sql`select id, current_plan_id as "currentPlanId" from users where email = ${email} limit 1`;
  if (!user) throw new Error(`User not found: ${email}`);
  if (analyze) {
    await analyzeHistory(sql, user.id, start, end);
  } else {
  const [templateRow] = await sql`select plan_data as "planData" from plans where id = ${user.currentPlanId} limit 1`;
  if (!templateRow) throw new Error("The user needs a current plan to provide profile and zone metadata");
  const activities = await sql`
    select id, provider_activity_id as "providerActivityId", activity_name as "activityName",
      local_date as "localDate", start_time_local as "startTimeLocal", distance_meters as "distanceMeters",
      duration_seconds as "durationSeconds"
    from run_activities where user_id = ${user.id} and local_date between ${start} and ${end}
    order by start_time_local asc
  `;
  if (activities.length === 0) throw new Error("No Garmin runs found in the requested date range");

  const planId = randomUUID();
  const historical = makePlan(planId, templateRow.planData, activities, start, end, raceDate, raceName);
  const report = {
    mode: apply ? "applied" : "dry-run",
    planId,
    raceName,
    start,
    end,
    weeks: historical.weeks.length,
    activities: activities.length,
    totalMiles: round(historical.weeks.reduce((sum, week) => sum + week.totalMileage, 0), 1),
    peakWeeklyMiles: historical.plan.peakWeeklyMileage,
    assignments: historical.assignments.length,
  };

  if (apply) {
    await sql.begin(async (tx) => {
      await tx`
        insert into plans (id,user_id,runner_profile,peak_mileage_override,weeks_override,plan_data,race_name)
        values (${planId},${user.id},${tx.json(historical.runnerProfile)},${Math.ceil(historical.plan.peakWeeklyMileage)},${historical.weeks.length},${tx.json(historical.plan)},${raceName})
      `;
      for (const assignment of historical.assignments) {
        await tx`
          update run_activities set plan_id=${planId},week_number=${assignment.weekNumber},
            day_of_week=${assignment.dayOfWeek},planned_workout_id=${assignment.workoutId},
            match_confidence=${assignment.confidence},updated_at=now()
          where id=${assignment.activityId} and user_id=${user.id}
        `;
      }
    });
  }

  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("Run again with --apply to create the plan.");
  }
} finally {
  await sql.end();
}
