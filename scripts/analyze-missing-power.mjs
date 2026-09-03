#!/usr/bin/env node

// Fits and validates athlete-specific power estimates without changing stored data.

import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const WINDOW_SECONDS = 30;
const MIN_SPEED = 1.8;
const MIN_HEART_RATE = 90;
const MAX_HEART_RATE = 200;
const MIN_POWER = 80;
const MAX_POWER = 700;
const MAX_ABSOLUTE_GRADE = 0.2;

const databaseUrl = process.env.DATABASE_URL || "postgresql://enduro:endurodev@localhost:5432/endurolab";
const email = argument("email");
const planId = argument("plan-id");
const raceName = argument("race");
const json = process.argv.includes("--json");
const apply = process.argv.includes("--apply");
const sql = postgres(databaseUrl, { prepare: false });

function argument(name) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage() {
  console.error(`Usage:
  npm run power:analyze -- --plan-id UUID
  npm run power:analyze -- --email runner@example.com --race Newport

Options:
  --json   Print machine-readable output
  --apply  Store estimates after validation gates pass`);
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function solve(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    if (Math.abs(augmented[column][column]) < 1e-10) return null;
    for (let row = column + 1; row < size; row += 1) {
      const factor = augmented[row][column] / augmented[column][column];
      for (let cell = column; cell <= size; cell += 1) {
        augmented[row][cell] -= factor * augmented[column][cell];
      }
    }
  }
  const result = Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    const remainder = augmented[row].slice(row + 1, size)
      .reduce((sum, value, index) => sum + value * result[row + index + 1], 0);
    result[row] = (augmented[row][size] - remainder) / augmented[row][row];
  }
  return result;
}

function fit(points, featureNames) {
  const columns = featureNames.length + 1;
  const matrix = Array.from({ length: columns }, () => Array(columns).fill(0));
  const vector = Array(columns).fill(0);
  for (const point of points) {
    const features = [1, ...featureNames.map((name) => point[name])];
    for (let row = 0; row < columns; row += 1) {
      vector[row] += features[row] * point.power;
      for (let column = 0; column < columns; column += 1) {
        matrix[row][column] += features[row] * features[column];
      }
    }
  }
  const coefficients = solve(matrix, vector);
  return coefficients ? { featureNames, coefficients } : null;
}

function predict(model, point) {
  return model.coefficients[0] + model.featureNames.reduce(
    (watts, name, index) => watts + model.coefficients[index + 1] * point[name],
    0,
  );
}

function metrics(actual, predicted) {
  const errors = actual.map((value, index) => predicted[index] - value);
  const average = mean(actual);
  const residual = errors.reduce((sum, value) => sum + value ** 2, 0);
  const total = actual.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return {
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(residual / errors.length),
    bias: mean(errors),
    rSquared: total > 0 ? 1 - residual / total : 0,
  };
}

function crossValidate(points, featureNames) {
  const activities = [...new Set(points.map((point) => point.activityId))];
  const actual = [];
  const predicted = [];
  const activityActual = [];
  const activityPredicted = [];
  for (const activityId of activities) {
    const training = points.filter((point) => point.activityId !== activityId);
    const validation = points.filter((point) => point.activityId === activityId);
    const model = fit(training, featureNames);
    if (!model) continue;
    const validationPredictions = validation.map((point) => predict(model, point));
    activityActual.push(mean(validation.map((point) => point.power)));
    activityPredicted.push(mean(validationPredictions));
    for (let index = 0; index < validation.length; index += 1) {
      const point = validation[index];
      actual.push(point.power);
      predicted.push(validationPredictions[index]);
    }
  }
  const windowMetrics = metrics(actual, predicted);
  const activityMetrics = metrics(activityActual, activityPredicted);
  return {
    ...windowMetrics,
    activityMae: activityMetrics.mae,
    activityRmse: activityMetrics.rmse,
    activityBias: activityMetrics.bias,
    activityRSquared: activityMetrics.rSquared,
  };
}

function windowsForActivity(samples, requirePower) {
  const buckets = new Map();
  for (const sample of samples) {
    if (
      sample.speed === null || sample.speed < MIN_SPEED
      || sample.heartRate === null || sample.heartRate < MIN_HEART_RATE || sample.heartRate > MAX_HEART_RATE
      || (requirePower && (sample.power === null || sample.power < MIN_POWER || sample.power > MAX_POWER))
    ) continue;
    const bucket = Math.floor(sample.elapsedSeconds / WINDOW_SECONDS);
    const values = buckets.get(bucket) ?? [];
    values.push(sample);
    buckets.set(bucket, values);
  }

  const windows = [];
  for (const values of buckets.values()) {
    if (values.length < 10) continue;
    const first = values[0];
    const last = values.at(-1);
    const distanceChange = Number.isFinite(last.distanceMeters) && Number.isFinite(first.distanceMeters)
      ? last.distanceMeters - first.distanceMeters
      : 0;
    const elevationChange = Number.isFinite(last.elevation) && Number.isFinite(first.elevation)
      ? last.elevation - first.elevation
      : 0;
    const grade = distanceChange > 10
      ? Math.max(-MAX_ABSOLUTE_GRADE, Math.min(MAX_ABSOLUTE_GRADE, elevationChange / distanceChange))
      : 0;
    windows.push({
      activityId: first.activityId,
      speed: mean(values.map((sample) => sample.speed)),
      heartRate: mean(values.map((sample) => sample.heartRate)),
      verticalSpeed: mean(values.map((sample) => sample.speed)) * grade,
      power: requirePower ? mean(values.map((sample) => sample.power)) : null,
      seconds: values.length,
    });
  }
  return windows;
}

function formula(model) {
  const labels = { speed: "speed_mps", heartRate: "heart_rate", verticalSpeed: "speed_mps*grade" };
  return model.featureNames.reduce(
    (text, name, index) => `${text} ${model.coefficients[index + 1] < 0 ? "-" : "+"} ${Math.abs(model.coefficients[index + 1]).toFixed(3)}*${labels[name]}`,
    `${model.coefficients[0].toFixed(3)}`,
  );
}

try {
  if (!planId && !email && !raceName) {
    usage();
    process.exitCode = 1;
  } else {
    const [plan] = await sql`
      select p.id, p.race_name as "raceName", u.email
      from plans p
      left join users u on u.id = p.user_id
      where ${planId ? sql`p.id = ${planId}` : sql`true`}
        and ${email ? sql`u.email = ${email}` : sql`true`}
        and ${raceName ? sql`p.race_name ilike ${`%${raceName}%`}` : sql`true`}
      order by p.created_at desc
      limit 1
    `;
    if (!plan) throw new Error("No matching plan found");

    const activities = await sql`
      select id, local_date as "localDate", activity_name as "activityName",
        distance_meters as "distanceMeters", duration_seconds as "durationSeconds",
        moving_duration_seconds as "movingDurationSeconds", average_heart_rate as "averageHeartRate",
        average_power as "averagePower", power_source as "powerSource"
      from run_activities
      where plan_id = ${plan.id}
      order by local_date, start_time_gmt
    `;
    const poweredActivities = activities.filter((activity) => (
      activity.averagePower !== null && !activity.powerSource.startsWith("estimated_")
    ));
    const trainingPoints = [];
    for (const activity of poweredActivities) {
      const samples = await sql`
        select ${activity.id}::text as "activityId", elapsed_seconds as "elapsedSeconds",
          distance_meters as "distanceMeters", heart_rate as "heartRate", power,
          speed_meters_per_second as speed, elevation_meters as elevation
        from activity_samples where activity_id = ${activity.id} order by elapsed_seconds
      `;
      trainingPoints.push(...windowsForActivity(samples, true));
    }

    if (poweredActivities.length < 5 || trainingPoints.length < 100) {
      throw new Error(`Insufficient measured power: ${poweredActivities.length} activities and ${trainingPoints.length} usable windows`);
    }
    const activityPoints = poweredActivities.map((activity) => {
      const seconds = activity.movingDurationSeconds ?? activity.durationSeconds;
      if (seconds <= 0) return null;
      return {
        activityId: activity.id,
        speed: activity.distanceMeters / seconds,
        heartRate: activity.averageHeartRate,
        power: activity.averagePower,
      };
    }).filter(Boolean);

    const candidates = [
      { name: "speed", features: ["speed"] },
      { name: "speed+heart-rate", features: ["speed", "heartRate"] },
    ].map((candidate) => ({
      ...candidate,
      validation: crossValidate(activityPoints, candidate.features),
    })).filter((candidate) => Number.isFinite(candidate.validation.activityRmse))
      .sort((left, right) => left.validation.activityRmse - right.validation.activityRmse);
    if (candidates.length === 0) throw new Error("No candidate model produced valid cross-validation metrics");
    const best = candidates[0];
    const model = fit(activityPoints, best.features);
    if (!model) throw new Error("Could not fit the selected model");

    const nearTermRows = await sql`
      select id, average_power as "averagePower", distance_meters as "distanceMeters",
        duration_seconds as "durationSeconds", moving_duration_seconds as "movingDurationSeconds",
        average_heart_rate as "averageHeartRate"
      from run_activities
      where user_id = (select user_id from plans where id = ${plan.id})
        and plan_id is distinct from ${plan.id}
        and average_power is not null
        and local_date > ${poweredActivities.at(-1).localDate}
        and local_date <= (${poweredActivities.at(-1).localDate}::date + interval '14 days')::text
        and duration_seconds >= 1200
        and activity_name not ilike '%treadmill%'
      order by local_date
    `;
    const nearTermPoints = nearTermRows.map((activity) => ({
      speed: activity.distanceMeters / (activity.movingDurationSeconds ?? activity.durationSeconds),
      heartRate: activity.averageHeartRate,
      power: activity.averagePower,
    })).filter((point) => model.featureNames.every((name) => Number.isFinite(point[name])));
    const nearTermValidation = nearTermPoints.length > 0
      ? metrics(nearTermPoints.map((point) => point.power), nearTermPoints.map((point) => predict(model, point)))
      : null;

    const estimates = [];
    for (const activity of activities.filter((item) => item.averagePower === null)) {
      const summarySeconds = activity.movingDurationSeconds ?? activity.durationSeconds;
      const point = {
        speed: summarySeconds > 0 ? activity.distanceMeters / summarySeconds : null,
        heartRate: activity.averageHeartRate,
      };
      const estimable = model.featureNames.every((name) => Number.isFinite(point[name]));
      estimates.push({
        id: activity.id,
        date: activity.localDate,
        activity: activity.activityName,
        estimatedPower: estimable ? Math.round(predict(model, point)) : null,
        basis: estimable ? "summary-pace" : null,
      });
    }

    const nearTermMeanPower = nearTermPoints.length > 0 ? mean(nearTermPoints.map((point) => point.power)) : null;
    const nearTermRmsePercentage = nearTermValidation && nearTermMeanPower
      ? nearTermValidation.rmse / nearTermMeanPower * 100
      : null;
    const nearTermBiasPercentage = nearTermValidation && nearTermMeanPower
      ? nearTermValidation.bias / nearTermMeanPower * 100
      : null;
    const accuracyPassed = best.validation.activityRmse <= 10
      && nearTermValidation !== null
      && nearTermPoints.length >= 5
      && nearTermRmsePercentage !== null && nearTermRmsePercentage <= 6
      && nearTermBiasPercentage !== null && Math.abs(nearTermBiasPercentage) <= 6;
    let appliedActivities = 0;
    if (apply) {
      if (!accuracyPassed) throw new Error("Accuracy gates failed; no estimates were applied");
      await sql.begin(async (transaction) => {
        for (const estimate of estimates) {
          if (estimate.estimatedPower === null) continue;
          const updated = await transaction`
            update run_activities
            set average_power = ${estimate.estimatedPower}, power_source = 'estimated_speed_v1', updated_at = now()
            where id = ${estimate.id} and plan_id = ${plan.id} and average_power is null
            returning id
          `;
          appliedActivities += updated.length;
        }
      });
    }

    const result = {
      plan: { id: plan.id, raceName: plan.raceName, email: plan.email },
      coverage: {
        activities: activities.length,
        measuredActivities: poweredActivities.length,
        estimatedActivities: activities.filter((activity) => activity.powerSource.startsWith("estimated_")).length,
        missingActivities: activities.filter((activity) => activity.averagePower === null).length,
        trainingWindows: trainingPoints.length,
        trainingHours: Math.round(trainingPoints.length * WINDOW_SECONDS / 36) / 100,
        firstMeasuredDate: poweredActivities[0]?.localDate ?? null,
        lastMeasuredDate: poweredActivities.at(-1)?.localDate ?? null,
        estimableMissingActivities: estimates.filter((estimate) => estimate.estimatedPower !== null).length,
        estimatedPowerRange: (() => {
          const powers = estimates.map((estimate) => estimate.estimatedPower).filter((value) => value !== null);
          return powers.length > 0 ? [Math.min(...powers), Math.max(...powers)] : null;
        })(),
      },
      candidates: candidates.map((candidate) => ({ name: candidate.name, ...candidate.validation })),
      selected: { name: best.name, formula: formula(model), ...best.validation },
      nearTermValidation: nearTermValidation ? {
        activities: nearTermPoints.length,
        ...nearTermValidation,
        rmsePercentage: nearTermRmsePercentage,
        biasPercentage: nearTermBiasPercentage,
      } : null,
      accuracyPassed,
      appliedActivities,
      estimates,
      caveat: "Modeled power is suitable for season-level trends, not as a replacement for measured second-by-second power.",
    };

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.plan.raceName} (${result.plan.email})`);
      console.log(`Measured power: ${result.coverage.measuredActivities}/${result.coverage.activities} activities, ${result.coverage.trainingHours} usable hours`);
      console.table(result.candidates.map((candidate) => ({
        model: candidate.name,
        run_MAE_W: candidate.activityMae.toFixed(1),
        run_RMSE_W: candidate.activityRmse.toFixed(1),
        run_bias_W: candidate.activityBias.toFixed(1),
        run_R2: candidate.activityRSquared.toFixed(3),
      })));
      console.log(`Selected formula: watts = ${result.selected.formula}`);
      console.log(`Near-term holdout: ${nearTermPoints.length} runs, ${nearTermValidation?.mae.toFixed(1) ?? "n/a"} W MAE, ${nearTermValidation?.rmse.toFixed(1) ?? "n/a"} W RMSE (${nearTermRmsePercentage?.toFixed(1) ?? "n/a"}%), ${nearTermValidation?.bias.toFixed(1) ?? "n/a"} W bias`);
      console.log(`Accuracy gates: ${accuracyPassed ? "passed" : "failed"}`);
      console.log(`Estimable missing activities: ${result.coverage.estimableMissingActivities}/${result.coverage.missingActivities}`);
      console.log(`Estimated average-power range: ${result.coverage.estimatedPowerRange?.join("-") ?? "none"} W`);
      if (apply) console.log(`Applied estimates: ${appliedActivities}`);
      console.log(result.caveat);
    }
  }
} catch (error) {
  console.error("Missing-power analysis failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
