/** Garmin dynamics contract (DOC-368): cm, ms, and percentage points, LEFT balance. */
export const DYNAMICS_FIELDS = {
  verticalOscillationCm: ["avgVerticalOscillation", "verticalOscillation", "directVerticalOscillation", 50],
  verticalRatioPercent: ["avgVerticalRatio", "verticalRatio", "directVerticalRatio", 100],
  groundContactTimeMs: ["avgGroundContactTime", "groundContactTime", "directGroundContactTime", 2000],
  groundContactBalanceLeftPercent: ["avgGroundContactBalance", "groundContactBalanceLeft", "directGroundContactBalanceLeft", 100],
  strideLengthCm: ["avgStrideLength", "strideLength", "directStrideLength", 1000],
};

/** Broad plausibility bounds, not coaching targets. Zero denotes unavailable sensor data. */
export function dynamicsValue(value, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
}

/** List summaries take precedence when present; summaryDTO uses explicitly left-side balance. */
export function mapGarminSummaryDynamics(payload) {
  const dto = payload?.summaryDTO ?? {};
  return Object.fromEntries(Object.entries(DYNAMICS_FIELDS).map(([field, [listKey, dtoKey, , maximum]]) => [
    field, dynamicsValue(payload?.[listKey] !== undefined ? payload[listKey] : dto[dtoKey], maximum),
  ]));
}
