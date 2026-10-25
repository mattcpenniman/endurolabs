/** Versioned dynamics-only detail validation, coverage and bounded retry policy. */
import { mapGarminActivityDetailRows } from "./activity-detail";

export const DYNAMICS_BACKFILL_VERSION = "dynamics-detail-v1";
export const DYNAMICS_COLUMNS = ["vertical_oscillation_cm", "vertical_ratio_percent", "ground_contact_time_ms",
  "ground_contact_balance_left_percent", "stride_length_cm"] as const;
export const DYNAMICS_PROPERTIES = ["verticalOscillationCm", "verticalRatioPercent", "groundContactTimeMs",
  "groundContactBalanceLeftPercent", "strideLengthCm"] as const;
export type DetailSample = ReturnType<typeof mapGarminActivityDetailRows>[number];
export type DynamicsCoverage = Record<typeof DYNAMICS_COLUMNS[number], number>;

export function sampleCoverage(samples: DetailSample[]): DynamicsCoverage {
  return Object.fromEntries(DYNAMICS_COLUMNS.map((column, index) => [column,
    samples.filter((sample) => sample[DYNAMICS_PROPERTIES[index]] !== null).length])) as DynamicsCoverage;
}

/** Require complete, aligned rows; repeated keys must agree on the dynamics-only patch. */
export function validateDynamicsDetail(payload: unknown, start: Date): DetailSample[] {
  const detail = payload as { metricDescriptors?: unknown[]; activityDetailMetrics?: unknown[]; totalMetricsCount?: number } | null;
  if (!detail || !Array.isArray(detail.metricDescriptors) || !Array.isArray(detail.activityDetailMetrics)
    || !Number.isSafeInteger(detail.totalMetricsCount) || detail.totalMetricsCount! < 0
    || detail.totalMetricsCount !== detail.activityDetailMetrics.length || detail.activityDetailMetrics.length >= 20000) {
    throw new Error("incomplete_detail");
  }
  const samples = mapGarminActivityDetailRows(payload, start);
  if (samples.length !== detail.activityDetailMetrics.length || samples.some((sample) =>
    Math.abs((sample.timestamp.getTime() - start.getTime()) / 1000 - sample.elapsedSeconds) > 1)) {
    throw new Error("invalid_alignment");
  }
  const byElapsed = new Map<number, DetailSample>();
  for (const sample of samples) {
    const previous = byElapsed.get(sample.elapsedSeconds);
    // Garmin can repeat a timestamp with different unrelated sensor values. Match
    // the existing mapper's last-row-wins key, but never choose between conflicting
    // dynamics or silently merge distinct subsecond timestamps into one sample.
    if (previous && (previous.timestamp.getTime() !== sample.timestamp.getTime()
      || DYNAMICS_PROPERTIES.some((key) => previous[key] !== sample[key]))) {
      throw new Error("invalid_alignment");
    }
    byElapsed.set(sample.elapsedSeconds, sample);
  }
  return [...byElapsed.values()].sort((left, right) => left.elapsedSeconds - right.elapsedSeconds);
}

export function backfillErrorCode(error: unknown): string {
  const candidate = error as { response?: { status?: number }; name?: string; message?: string };
  const status = candidate?.response?.status;
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403 || candidate?.name === "GarminSessionExpiredError") return "auth_required";
  if (candidate?.name === "GarminMfaRequiredError") return "mfa_required";
  if (["incomplete_detail", "invalid_alignment", "stored_alignment_changed", "coverage_mismatch", "ownership_lost"].includes(candidate?.message ?? "")) {
    return candidate.message!;
  }
  return "request_failed";
}

/** Retry-After is honored up to five minutes; longer waits defer to the next invocation. */
export function retryDelay(error: unknown, attempt: number): number | null {
  const code = backfillErrorCode(error);
  if (["auth_required", "mfa_required", "ownership_lost", "invalid_alignment", "stored_alignment_changed",
    "incomplete_detail", "coverage_mismatch"].includes(code) || attempt >= 3) return null;
  const value = (error as { response?: { headers?: Record<string, unknown> } })?.response?.headers?.["retry-after"];
  const seconds = Number(value);
  const delay = value === undefined ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - Date.now();
  if (delay > 300_000) return null;
  return Math.max(Number.isFinite(delay) ? delay : 0, 2000 * 2 ** (attempt - 1));
}

export interface BackfillOptions { email?: string; userId?: string; since?: string; through?: string; limit: number; apply: boolean; retryFailed: boolean }
export function parseBackfillOptions(args: string[]): BackfillOptions {
  const values = new Map<string, string>();
  let apply = false;
  let retryFailed = false;
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split("=", 2);
    if (flag === "--apply" && inline === undefined) { apply = true; continue; }
    if (flag === "--retry-failed" && inline === undefined) { retryFailed = true; continue; }
    if (!["--email", "--user-id", "--since", "--through", "--limit"].includes(flag) || values.has(flag)) throw new Error("Invalid or repeated option");
    const value = inline ?? args[++index];
    if (!value || value.startsWith("--")) throw new Error("Option requires a value");
    values.set(flag, value);
  }
  const email = values.get("--email"), userId = values.get("--user-id");
  if (Boolean(email) === Boolean(userId)) throw new Error("Provide exactly one of --email or --user-id");
  if (userId && !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(userId)) throw new Error("Invalid user ID");
  for (const key of ["--since", "--through"]) {
    const value = values.get(key);
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error("Invalid date");
  }
  const since = values.get("--since"), through = values.get("--through");
  if (since && through && since > through) throw new Error("Date range reversed");
  const limit = Number(values.get("--limit") ?? 100);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Limit must be 1-1000");
  return { email, userId, since, through, limit, apply, retryFailed };
}
