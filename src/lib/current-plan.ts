// ============================================================
// EnduroLab — Current Plan Helpers
// ============================================================
// Client-side helpers for tracking the user's active plan
// across pages without introducing server-side schema changes.
// ============================================================

export const ACTIVE_PLAN_STORAGE_KEY = "endurlab-active-plan-id";
export const ACTIVE_PLAN_EVENT = "endurlab-active-plan-changed";

export function getActivePlanId(): string | null {
  if (typeof window === "undefined") return null;

  const planId = window.localStorage.getItem(ACTIVE_PLAN_STORAGE_KEY)?.trim() ?? "";
  return planId.length > 0 ? planId : null;
}

export function setActivePlanId(planId: string): void {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(ACTIVE_PLAN_STORAGE_KEY, planId);
  window.dispatchEvent(new CustomEvent(ACTIVE_PLAN_EVENT, { detail: { planId } }));
}

export function clearActivePlanId(): void {
  if (typeof window === "undefined") return;

  window.localStorage.removeItem(ACTIVE_PLAN_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(ACTIVE_PLAN_EVENT, { detail: { planId: null } }));
}
