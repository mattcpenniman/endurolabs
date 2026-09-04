import { describe, expect, it } from "vitest";
import { buildPlanUrl, isSafeInternalRedirect } from "@/lib/plan-url";

describe("plan URL state", () => {
  it("updates one value while preserving other parameters and the hash", () => {
    const params = new URLSearchParams("view=current&tab=schedule&source=email");

    expect(buildPlanUrl(params, { runmap: "activity-1" }, "#weekly-schedule")).toBe(
      "/plan?view=current&tab=schedule&source=email&runmap=activity-1#weekly-schedule"
    );
  });

  it("removes only explicitly cleared values", () => {
    const params = new URLSearchParams("plan=plan-1&tab=overview&runmap=activity-1");

    expect(buildPlanUrl(params, { runmap: null })).toBe("/plan?plan=plan-1&tab=overview");
  });

  it("encodes query values", () => {
    expect(buildPlanUrl(new URLSearchParams(), { runmap: "09/04/26 6mi" })).toBe(
      "/plan?runmap=09%2F04%2F26+6mi"
    );
  });
});

describe("internal redirects", () => {
  it("accepts local paths and rejects protocol-relative or external URLs", () => {
    expect(isSafeInternalRedirect("/plan?view=current#pace-zones")).toBe(true);
    expect(isSafeInternalRedirect("//example.com/plan")).toBe(false);
    expect(isSafeInternalRedirect("https://example.com/plan")).toBe(false);
  });
});
