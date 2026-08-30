// ============================================================
// EnduroLab - Training Date Utilities
// ============================================================
// Plan timestamps represent calendar dates in UTC. Formatting
// them in UTC prevents the browser timezone changing the date.
// ============================================================

export function formatPlanDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(date));
}
