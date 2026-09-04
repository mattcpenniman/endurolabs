// ============================================================
// EnduroLab - Plan URL State
// ============================================================
// Pure helpers for preserving shareable plan-page UI state.

export type PlanUrlKey = "view" | "plan" | "tab" | "runmap";
export type PlanUrlUpdates = Partial<Record<PlanUrlKey, string | null>>;

export function buildPlanUrl(
  currentParams: Pick<URLSearchParams, "toString">,
  updates: PlanUrlUpdates,
  hash = ""
): string {
  const params = new URLSearchParams(currentParams.toString());

  for (const [key, value] of Object.entries(updates) as Array<[PlanUrlKey, string | null | undefined]>) {
    if (value) {
      params.set(key, value);
    } else if (value === null) {
      params.delete(key);
    }
  }

  const query = params.toString();
  const normalizedHash = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `/plan${query ? `?${query}` : ""}${normalizedHash}`;
}

/** Adds a selected public run card to an existing tokenized plan share URL. */
export function buildSharedRunUrl(baseUrl: string, activityId: string, origin?: string): string {
  const url = new URL(baseUrl, origin ?? "http://localhost");
  url.searchParams.set("runmap", activityId);
  return baseUrl.startsWith("/") && origin === undefined
    ? `${url.pathname}${url.search}${url.hash}`
    : url.toString();
}

export function isSafeInternalRedirect(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}
