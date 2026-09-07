// ============================================================
// EnduroLab - GPX Course Parsing
// ============================================================
// Pure GPX (track points only) parser and course-geometry
// helpers. Points arrive as plain coordinates — no DOM, no
// XML dependency — so this runs identically in the Node API
// routes and in Vitest. Elevation is optional per point;
// grade is derived from consecutive pairs (Δelevation ÷
// ground distance), mirroring the elevation-grade analytics
// conventions.
// ============================================================

export const PROFILE_STEP = 200;

export interface GpsPoint {
  latitude: number;
  longitude: number;
  elevationMeters: number | null;
}

export interface CoursePoint extends GpsPoint {
  /** Cumulative ground distance from the start of the course. */
  cumulativeMeters: number;
}

export interface CourseGradeBand {
  key: "steep_descending" | "descending" | "flat" | "climbing" | "steep_climbing";
  label: string;
  distanceMeters: number;
  sharePercent: number;
}

export interface CourseProfilePoint {
  distanceMeters: number;
  elevationMeters: number | null;
}

const EARTH_RADIUS_METERS = 6_371_000;
const MAXIMUM_TRACK_DISTANCE_METERS = 500_000;
const FLAT_GRADE_TOLERANCE = 0.02;
const CLIMB_GRADE_THRESHOLD = 0.05;

const TRKPT_TAG = /<(?:\w+:)?trkpt\b[^>]*?\/?>/g;
const LAT = /\blat="(-?[\d.]+)"/;
const LON = /\blon="(-?[\d.]+)"/;
const ELE = /<ele>\s*(-?[\d.]+)\s*<\/ele>/;

export function parseGPXTrkpoints(xml: string): GpsPoint[] {
  const points: GpsPoint[] = [];
  let match: RegExpExecArray | null;
  TRKPT_TAG.lastIndex = 0;
  while ((match = TRKPT_TAG.exec(xml)) !== null) {
    const tag = match[0];
    const latMatch = LAT.exec(tag);
    const lonMatch = LON.exec(tag);
    if (!latMatch || !lonMatch) continue;
    const latitude = Number(latMatch[1]);
    const longitude = Number(lonMatch[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const isSelfClosing = /\/\s*>$/.test(tag);
    let elevation: number | null = null;
    if (!isSelfClosing) {
      // A non-self-closing trkpt may carry an <ele> child before </trkpt>.
      const rest = xml.slice(match.index + tag.length);
      const closeIndex = rest.indexOf("</trkpt>");
      const scoped = closeIndex === -1 ? rest : rest.slice(0, closeIndex);
      const eleMatch = ELE.exec(scoped);
      if (eleMatch) {
        const value = Number(eleMatch[1]);
        if (Number.isFinite(value)) elevation = value;
      }
    }
    points.push({ latitude, longitude, elevationMeters: elevation });
  }
  return points;
}

export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Computes running ground distance per point for an ordered track. */
export function buildCoursePoints(points: GpsPoint[]): CoursePoint[] {
  const out: CoursePoint[] = [];
  let cumulative = 0;
  let previous: GpsPoint | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) continue;
    if (previous !== null) cumulative += haversineMeters(previous, point);
    out.push({ ...point, cumulativeMeters: cumulative });
    previous = point;
  }
  if (out.length > 0 && out[out.length - 1].cumulativeMeters > MAXIMUM_TRACK_DISTANCE_METERS) {
    throw new Error("Course is too long — check that the GPX file contains a single running route.");
  }
  return out;
}

export function courseElevationSummary(points: CoursePoint[]): {
  gainMeters: number;
  lossMeters: number;
  netMeters: number;
  elevationCoverage: number;
} {
  let gainMeters = 0;
  let lossMeters = 0;
  let covered = 0;
  let previous: CoursePoint | null = null;
  for (const point of points) {
    if (point.elevationMeters === null) continue;
    if (previous !== null && previous.elevationMeters !== null) {
      const delta = point.elevationMeters - previous.elevationMeters;
      if (delta > 0) gainMeters += delta;
      else lossMeters += -delta;
    }
    covered += 1;
    previous = point;
  }
  const first = points.find((p) => p.elevationMeters !== null)?.elevationMeters ?? null;
  const last = [...points].reverse().find((p) => p.elevationMeters !== null)?.elevationMeters ?? null;
  return {
    gainMeters,
    lossMeters,
    netMeters: first !== null && last !== null ? last - first : 0,
    elevationCoverage: points.length > 0 ? covered / points.length : 0,
  };
}

export function gradeBands(points: CoursePoint[]): CourseGradeBand[] {
  const bands: Record<CourseGradeBand["key"], number> = {
    steep_descending: 0,
    descending: 0,
    flat: 0,
    climbing: 0,
    steep_climbing: 0,
  };
  let coveredMeters = 0;
  let previous: CoursePoint | null = null;
  for (const point of points) {
    if (previous !== null
      && previous.elevationMeters !== null
      && point.elevationMeters !== null) {
      const segmentMeters = point.cumulativeMeters - previous.cumulativeMeters;
      if (segmentMeters > 0 && segmentMeters < 2_000) {
        const grade = (point.elevationMeters - previous.elevationMeters) / segmentMeters;
        if (Number.isFinite(grade) && Math.abs(grade) <= 0.25) {
          if (grade <= -CLIMB_GRADE_THRESHOLD) bands.steep_descending += segmentMeters;
          else if (grade < -FLAT_GRADE_TOLERANCE) bands.descending += segmentMeters;
          else if (grade <= FLAT_GRADE_TOLERANCE) bands.flat += segmentMeters;
          else if (grade < CLIMB_GRADE_THRESHOLD) bands.climbing += segmentMeters;
          else bands.steep_climbing += segmentMeters;
          coveredMeters += segmentMeters;
        }
      }
    }
    previous = point;
  }
  const labels: Record<CourseGradeBand["key"], string> = {
    steep_descending: "Steep down (5%+)",
    descending: "Down (2-5%)",
    flat: "Flat (±2%)",
    climbing: "Up (2-5%)",
    steep_climbing: "Steep up (5%+)",
  };
  const order: CourseGradeBand["key"][] = [
    "steep_descending", "descending", "flat", "climbing", "steep_climbing",
  ];
  return order.map((key) => ({
    key,
    label: labels[key],
    distanceMeters: Math.round(bands[key]),
    sharePercent: coveredMeters > 0
      ? Math.round((bands[key] / coveredMeters) * 1000) / 10
      : 0,
  }));
}

/**
 * Interpolates an elevation profile onto a fixed set of evenly spaced
 * sample distances so two courses of different length can be overlaid.
 */
export function resampleProfile(
  points: CourseProfilePoint[],
  sampleDistances: number[],
): CourseProfilePoint[] {
  const valid = points
    .slice()
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .filter((p) => Number.isFinite(p.distanceMeters) && p.distanceMeters >= 0)
    .filter((p, index) => index === 0 || p.distanceMeters > points[index - 1].distanceMeters + 0.5
      || (!Number.isFinite(points[index - 1].distanceMeters)));
  return sampleDistances.map((distance) => {
    if (valid.length === 0 || valid[valid.length - 1].elevationMeters === null) {
      return { distanceMeters: distance, elevationMeters: null };
    }
    if (distance <= valid[0].distanceMeters) {
      return { distanceMeters: distance, elevationMeters: valid[0].elevationMeters };
    }
    for (let i = 1; i < valid.length; i += 1) {
      const a = valid[i - 1];
      const b = valid[i];
      if (distance <= b.distanceMeters) {
        if (a.elevationMeters === null || b.elevationMeters === null) {
          return { distanceMeters: distance, elevationMeters: null };
        }
        const span = b.distanceMeters - a.distanceMeters;
        const t = span > 0 ? (distance - a.distanceMeters) / span : 0;
        return {
          distanceMeters: distance,
          elevationMeters: a.elevationMeters + t * (b.elevationMeters - a.elevationMeters),
        };
      }
    }
    const last = valid[valid.length - 1];
    return { distanceMeters: distance, elevationMeters: last.elevationMeters };
  });
}
