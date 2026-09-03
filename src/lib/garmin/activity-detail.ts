// ============================================================
// EnduroLab - Garmin Activity Detail Mapping
// ============================================================

export interface GarminActivitySample {
  timestamp: Date;
  elapsedSeconds: number;
  distanceMeters: number | null;
  heartRate: number | null;
  power: number | null;
  speedMetersPerSecond: number | null;
  elevationMeters: number | null;
  grade: number | null;
  cadence: number | null;
  latitude: number | null;
  longitude: number | null;
  temperatureCelsius: number | null;
}

interface MetricDescriptor {
  key?: unknown;
  metricsIndex?: unknown;
  index?: unknown;
}

interface ActivityDetailPayload {
  metricDescriptors?: unknown;
  activityDetailMetrics?: unknown;
  metrics?: unknown;
}

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
} as const;

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integer(value: unknown): number | null {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number);
}

function coordinate(value: unknown): number | null {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.abs(number) > 180 ? number * (180 / 2 ** 31) : number;
}

function dateFromValue(value: unknown): Date | null {
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

function descriptorIndexes(payload: ActivityDetailPayload): Map<string, number> {
  const descriptors = Array.isArray(payload.metricDescriptors) ? payload.metricDescriptors : [];
  const indexes = new Map<string, number>();
  descriptors.forEach((rawDescriptor, fallbackIndex) => {
    if (!rawDescriptor || typeof rawDescriptor !== "object") return;
    const descriptor = rawDescriptor as MetricDescriptor;
    if (typeof descriptor.key !== "string") return;
    const explicitIndex = integer(descriptor.metricsIndex ?? descriptor.index);
    indexes.set(normalizedKey(descriptor.key), explicitIndex ?? fallbackIndex);
  });
  return indexes;
}

function metricRows(payload: ActivityDetailPayload): unknown[] {
  if (Array.isArray(payload.activityDetailMetrics)) return payload.activityDetailMetrics;
  if (payload.activityDetailMetrics && typeof payload.activityDetailMetrics === "object") {
    const nested = payload.activityDetailMetrics as { metrics?: unknown };
    if (Array.isArray(nested.metrics)) return nested.metrics;
  }
  return Array.isArray(payload.metrics) ? payload.metrics : [];
}

function rowValue(row: unknown, indexes: Map<string, number>, aliases: readonly string[]): unknown {
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
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

/** Maps Garmin's descriptor-indexed detail response into stable database samples. */
export function mapGarminActivityDetail(payload: unknown, activityStart: Date): GarminActivitySample[] {
  if (!payload || typeof payload !== "object") return [];
  const detail = payload as ActivityDetailPayload;
  const indexes = descriptorIndexes(detail);
  const samples = metricRows(detail).flatMap((row): GarminActivitySample[] => {
    const elapsed = finiteNumber(rowValue(row, indexes, METRIC_ALIASES.elapsedSeconds));
    const rawTimestamp = dateFromValue(rowValue(row, indexes, METRIC_ALIASES.timestamp));
    const timestamp = rawTimestamp ?? (elapsed === null ? null : new Date(activityStart.getTime() + elapsed * 1000));
    const derivedElapsed = elapsed ?? (timestamp ? (timestamp.getTime() - activityStart.getTime()) / 1000 : null);
    if (!timestamp || derivedElapsed === null || derivedElapsed < 0) return [];

    return [{
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

  const byElapsed = new Map<number, GarminActivitySample>();
  for (const sample of samples) byElapsed.set(sample.elapsedSeconds, sample);
  return [...byElapsed.values()].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
}
