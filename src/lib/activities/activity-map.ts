// ============================================================
// EnduroLab - GPS Route Map Utilities
// ============================================================
// Pure projection and hit-testing helpers used to render a
// Garmin activity as a 2D SVG route.  Longitude/latitude are
// projected via an equirectangular approximation centered on
// the route midpoint (cosine-corrected for the latitude),
// then scaled to fit an integer viewBox with uniform padding.

import type { ActivityChartSample } from "@/lib/activities/models";

export interface GpsPoint {
  index: number;
  x: number;
  y: number;
}
export interface GpsProjection {
  points: GpsPoint[];
  width: number;
  height: number;
}

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function projectGpsRoute(
  samples: ActivityChartSample[],
  width = 640,
  height = 400,
  padding = 26
): GpsProjection {
  const coords = samples
    .map((s) => [s.latitude ?? null, s.longitude ?? null])
    .filter((c): c is [number, number] => typeof c[0] === "number" && typeof c[1] === "number");

  if (coords.length === 0) return { points: [], width, height };

  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;
  for (const [la, lo] of coords) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLng) minLng = lo;
    if (lo > maxLng) maxLng = lo;
  }

  const latC = (minLat + maxLat) / 2;
  const lngC = (minLng + maxLng) / 2;
  const kx = EARTH_R * DEG * Math.cos(latC * DEG);
  const ky = EARTH_R * DEG;

  let minPx = Infinity, maxPx = -Infinity;
  let minPy = Infinity, maxPy = -Infinity;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [la, lo] of coords) {
    const px = (lo - lngC) * kx;
    const py = -(la - latC) * ky;
    xs.push(px); ys.push(py);
    if (px < minPx) minPx = px;
    if (px > maxPx) maxPx = px;
    if (py < minPy) minPy = py;
    if (py > maxPy) maxPy = py;
  }

  const w = maxPx - minPx;
  const h = maxPy - minPy;
  const availW = Math.max(1, width - 2 * padding);
  const availH = Math.max(1, height - 2 * padding);
  const scale = Math.min(availW / Math.max(w, 1e-9), availH / Math.max(h, 1e-9));
  const cx0 = (minPx + maxPx) / 2;
  const cy0 = (minPy + maxPy) / 2;
  const ox = width / 2 - cx0 * scale;
  const oy = height / 2 - cy0 * scale;

  const points: GpsPoint[] = [];
  for (let i = 0; i < xs.length; i++) {
    points.push({
      index: i,
      x: clamp(xs[i] * scale + ox, 0, width),
      y: clamp(ys[i] * scale + oy, 0, height),
    });
  }

  return { points, width, height };
}

export function nearestPointIndex(
  points: GpsPoint[],
  tx: number,
  ty: number,
  thresholdPx = 24
): number | null {
  if (points.length === 0) return null;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dx = points[i].x - tx;
    const dy = points[i].y - ty;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best === -1 || bestD > thresholdPx * thresholdPx) return null;
  return best;
}

export function haversineMeters(
  la1: number, lo1: number,
  la2: number, lo2: number
): number {
  const dLa = (la2 - la1) * DEG;
  const dLo = (lo2 - lo1) * DEG;
  const a = Math.sin(dLa / 2) ** 2 +
    Math.cos(la1 * DEG) * Math.cos(la2 * DEG) * Math.sin(dLo / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}
