// ============================================================
// EnduroLab - Open-Elevation Backfill
// ============================================================
// Fills null per-point elevation for an uploaded GPX course via
// the keyless Open-Elevation API (api.open-elevation.com, ~250k
// lookup points/day free quota).
//
// Design: all-or-nothing per course — if any batch fails the
// caller persists nothing, so a course never mixes real
// elevation with partially missing data. The API base is
// overridable via OPEN_ELEVATION_API_BASE for tests/alternate
// providers. Lookups are batched 50 points per request and run
// sequentially with bounded retries on transient throttles, since
// the service is free/quota-limited and shared-IP throttles do
// happen.
// ============================================================

export interface LookupPoint {
  latitude: number;
  longitude: number;
}

export class OpenElevationError extends Error {
  readonly status: "rate_limited" | "http_error" | "malformed" | "network";
  constructor(status: OpenElevationError["status"], message: string) {
    super(message);
    this.name = "OpenElevationError";
    this.status = status;
  }
}

export const LOOKUP_BATCH_SIZE = 50;
export const LOOKUP_TIMEOUT_MS = 30_000;
/** Free quota-limited service: run sequentially with a short pause between
 *  batches and a small number of retries so a transient throttle self-heals
 *  instead of hard-failing the whole backfill. */
export const RETRYABLE_DELAYS_MS = [1500, 4000] as const;
const INTER_BATCH_DELAY_MS = 250;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolved at call time so tests/scripts can override via env. */
export function getBaseUrl(): string {
  return process.env.OPEN_ELEVATION_API_BASE?.replace(/\/+$/, "") ?? "https://api.open-elevation.com";
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Builds a lookup URL in the order-preserving locations=lat,lon|... form. */
export function buildLookupUrl(points: LookupPoint[], baseUrl: string = getBaseUrl()): string {
  const base = baseUrl.replace(/\/+$/, "");
  const locations = points
    .map((p) => `${p.latitude.toFixed(7)},${p.longitude.toFixed(7)}`)
    .join("|");
  return `${base}/api/v1/lookup?locations=${encodeURIComponent(locations)}`;
}

interface LookupResult {
  latitude?: number;
  longitude?: number;
  elevation?: number;
}

/**
 * Validates and re-orders an Open-Elevation response against the request
 * points. The API echoes points back in request order, but we verify by
 * coordinate so a silent reorder cannot corrupt the elevation trace.
 */
export function parseLookupResults(body: unknown, requested: LookupPoint[]): number[] {
  if (typeof body !== "object" || body === null || !Array.isArray((body as { results?: unknown }).results)) {
    throw new OpenElevationError("malformed", "Open-Elevation returned an unexpected response shape.");
  }
  const results = (body as { results: LookupResult[] }).results;
  if (results.length !== requested.length) {
    throw new OpenElevationError("malformed", "Open-Elevation returned a different number of points than requested.");
  }
  const elevations: number[] = [];
  for (let i = 0; i < requested.length; i += 1) {
    const result = results[i];
    const requestedPoint = requested[i];
    if (
      typeof result?.elevation !== "number"
      || !Number.isFinite(result.elevation)
      || typeof result.latitude !== "number"
      || typeof result.longitude !== "number"
      || Math.abs(result.latitude - requestedPoint.latitude) > 5e-5
      || Math.abs(result.longitude - requestedPoint.longitude) > 5e-5
    ) {
      throw new OpenElevationError(
        "malformed",
        `Open-Elevation did not return a valid elevation for point ${i + 1}.`,
      );
    }
    elevations.push(result.elevation);
  }
  return elevations;
}

export interface ElevationLookupOptions {
  /** Retry delays between attempts (default RETRYABLE_DELAYS_MS). */
  retryDelaysMs?: readonly number[];
  /** Pause between sequential batches (default INTER_BATCH_DELAY_MS). */
  interBatchDelayMs?: number;
}

/** Runs one lookup batch with retry/backoff on transient throttles. */
async function fetchChunk(
  points: LookupPoint[],
  options: ElevationLookupOptions,
): Promise<number[]> {
  const delays = options.retryDelaysMs ?? RETRYABLE_DELAYS_MS;
  let lastError: OpenElevationError | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await fetchChunkOnce(points);
    } catch (error) {
      if (!(error instanceof OpenElevationError) || error.status === "malformed") throw error;
      lastError = error;
      const delay = delays[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw lastError ?? new OpenElevationError("network", "Elevation lookup failed.");
}

async function fetchChunkOnce(points: LookupPoint[]): Promise<number[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(buildLookupUrl(points), { signal: controller.signal });
    if (response.status === 403 || response.status === 429) {
      throw new OpenElevationError(
        "rate_limited",
        "Open-Elevation rate limit reached. The free tier allows ~250k lookup points per day — try again later.",
      );
    }
    if (!response.ok) {
      throw new OpenElevationError("http_error", `Open-Elevation request failed (HTTP ${response.status}).`);
    }
    const body: unknown = await response.json();
    return parseLookupResults(body, points);
  } catch (error) {
    if (error instanceof OpenElevationError) throw error;
    throw new OpenElevationError("network", `Could not reach Open-Elevation: ${error instanceof Error ? error.message : "network error"}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches DEM elevations for `points` (in order). Batches of
 * 50 points run sequentially with a short pause between them and
 * bounded retries on transient throttles. All-or-nothing: any
 * terminal failure rejects the whole call so nothing partial may
 * be persisted.
 */
export async function fetchElevations(
  points: LookupPoint[],
  options: ElevationLookupOptions = {},
): Promise<number[]> {
  if (points.length === 0) return [];
  const interBatch = options.interBatchDelayMs ?? INTER_BATCH_DELAY_MS;
  const batches = chunk(points, LOOKUP_BATCH_SIZE);
  const results: number[] = [];
  for (let i = 0; i < batches.length; i += 1) {
    if (i > 0 && interBatch > 0) await sleep(interBatch);
    results.push(...(await fetchChunk(batches[i], options)));
  }
  return results;
}
