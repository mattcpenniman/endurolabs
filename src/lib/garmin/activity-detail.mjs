// ============================================================
// EnduroLab - Garmin Activity Detail Mapping
// ============================================================

import { DYNAMICS_FIELDS, dynamicsValue } from "./running-dynamics.mjs";

const METRIC_ALIASES = {
  timestamp: ["directtimestamp", "timestamp", "time"],
  elapsedSeconds: ["directelapsedtime", "elapsedtime", "elapsedseconds", "timerTime"],
  distanceMeters: ["directdistance", "distance"],
  heartRate: ["directheartrate", "heartrate"],
  power: ["directpower", "power", "enhancedpower"],
  speedMetersPerSecond: ["directspeed", "speed", "enhancedspeed"],
  elevationMeters: ["directelevation", "elevation", "enhancedelevation", "altitude"],
  grade: ["directgrade", "grade"],
  cadence: ["directruncadence", "runcadence", "directcadence", "cadence"],
  latitude: ["directlatitude", "latitude", "positionlat"],
  longitude: ["directlongitude", "longitude", "positionlong"],
  temperatureCelsius: ["directtemperature", "temperature"],
};

function normalizedKey(value) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function finiteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integer(value) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function coordinate(value) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.abs(number) > 180 ? number * (180 / 2 ** 31) : number;
}

function dateFromValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const numeric = finiteNumber(value);
  if (numeric !== null) {
    const date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function descriptorIndexes(payload) {
  const descriptors = Array.isArray(payload.metricDescriptors) ? payload.metricDescriptors : [];
  const indexes = new Map();
  descriptors.forEach((rawDescriptor, fallbackIndex) => {
    if (!rawDescriptor || typeof rawDescriptor !== "object") return;
    const descriptor = rawDescriptor;
    if (typeof descriptor.key !== "string") return;
    const explicitIndex = integer(descriptor.metricsIndex ?? descriptor.index);
    indexes.set(normalizedKey(descriptor.key), explicitIndex ?? fallbackIndex);
  });
  return indexes;
}

function metricRows(payload) {
  if (Array.isArray(payload.activityDetailMetrics)) return payload.activityDetailMetrics;
  if (payload.activityDetailMetrics && typeof payload.activityDetailMetrics === "object") {
    const nested = payload.activityDetailMetrics;
    if (Array.isArray(nested.metrics)) return nested.metrics;
  }
  return Array.isArray(payload.metrics) ? payload.metrics : [];
}

function rowValue(row, indexes, aliases) {
  if (!row || typeof row !== "object") return undefined;
  const record = row;
  const metrics = Array.isArray(record.metrics) ? record.metrics : Array.isArray(row) ? row : null;
  for (const alias of aliases) {
    const target = normalizedKey(alias);
    if (metrics) {
      const index = indexes.get(target);
      if (index !== undefined && metrics[index] !== undefined) return metrics[index];
    }
    const directKey = Object.keys(record).find((key) => normalizedKey(key) === target);
    if (directKey) return record[directKey];
  }
  return undefined;
}

/** Maps each provider row before the legacy last-row-wins elapsed-key reduction. */
export function mapGarminActivityDetailRows(payload, activityStart) {
  if (!payload || typeof payload !== "object") return [];
  const detail = payload;
  const indexes = descriptorIndexes(detail);
  const dynamicsDescriptors = Object.entries(DYNAMICS_FIELDS).map(([field, [, , descriptor, maximum]]) => {
    // Garmin's literal unit key is "centimeter" (DOC-368 original probe); cm is an equivalent abbreviation.
    const metadata = Array.isArray(detail.metricDescriptors)
      ? detail.metricDescriptors.find((item) => typeof item?.key === "string" && normalizedKey(item.key) === normalizedKey(descriptor))
      : null;
    const expectedUnits = field.endsWith("Cm") ? ["centimeter", "cm"] : field.endsWith("Ms") ? ["ms"] : ["dimensionless"];
    const unit = metadata?.unit?.key ?? metadata?.unit;
    const factor = metadata?.unit?.factor;
    const validUnit = (unit === undefined || expectedUnits.includes(unit)) && (factor === undefined || factor === 1);
    return { field, descriptor, maximum, validUnit };
  });
  const samples = metricRows(detail).flatMap((row) => {
    const elapsed = finiteNumber(rowValue(row, indexes, METRIC_ALIASES.elapsedSeconds));
    const rawTimestamp = dateFromValue(rowValue(row, indexes, METRIC_ALIASES.timestamp));
    const timestamp = rawTimestamp ?? (elapsed === null ? null : new Date(activityStart.getTime() + elapsed * 1000));
    const derivedElapsed = elapsed ?? (timestamp ? (timestamp.getTime() - activityStart.getTime()) / 1000 : null);
    if (!timestamp || derivedElapsed === null || derivedElapsed < 0) return [];

    const dynamics = Object.fromEntries(dynamicsDescriptors.map(({ field, descriptor, maximum, validUnit }) => [
      field, validUnit ? dynamicsValue(rowValue(row, indexes, [descriptor]), maximum) : null,
    ]));
    return [{
      ...dynamics,
      timestamp,
      elapsedSeconds: Math.round(derivedElapsed),
      distanceMeters: finiteNumber(rowValue(row, indexes, METRIC_ALIASES.distanceMeters)),
      heartRate: integer(rowValue(row, indexes, METRIC_ALIASES.heartRate)),
      power: integer(rowValue(row, indexes, METRIC_ALIASES.power)),
      speedMetersPerSecond: finiteNumber(rowValue(row, indexes, METRIC_ALIASES.speedMetersPerSecond)),
      elevationMeters: finiteNumber(rowValue(row, indexes, METRIC_ALIASES.elevationMeters)),
      grade: finiteNumber(rowValue(row, indexes, METRIC_ALIASES.grade)),
      cadence: integer(rowValue(row, indexes, METRIC_ALIASES.cadence)),
      latitude: coordinate(rowValue(row, indexes, METRIC_ALIASES.latitude)),
      longitude: coordinate(rowValue(row, indexes, METRIC_ALIASES.longitude)),
      temperatureCelsius: finiteNumber(rowValue(row, indexes, METRIC_ALIASES.temperatureCelsius)),
    }];
  });

  return samples;
}

/** Maps Garmin's descriptor-indexed detail response into stable database samples. */
export function mapGarminActivityDetail(payload, activityStart) {
  const samples = mapGarminActivityDetailRows(payload, activityStart);
  const byElapsed = new Map();
  for (const sample of samples) byElapsed.set(sample.elapsedSeconds, sample);
  return [...byElapsed.values()].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
}
