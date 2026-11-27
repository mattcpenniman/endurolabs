/** Profile counts reflect the full sync history, not just the returned activity page. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GarminConnectCard from "@/app/components/profile/GarminConnectCard";
import type { GarminConnectionStatus, RunActivity } from "@/lib/activities/models";

// Only fields rendered in the recent-quality list are needed by this fixture.
const activities = Array.from({ length: 1000 }, (_, index) => ({
  id: `run-${index}`, activityName: "Run", localDate: "2026-11-26",
  samplesFetchedAt: "2026-11-26T12:00:00Z", sampleCount: 0,
}) as RunActivity);
function render(overrides: Partial<GarminConnectionStatus> = {}): string {
  return renderToStaticMarkup(<GarminConnectCard
    connection={{ connected: true, activities, ...overrides }} onChanged={async () => {}} />);
}

describe("Garmin profile totals", () => {
  it("shows aggregate totals even when only 1000 runs were returned", () => {
    const html = render({ totalActivities: 1234, activitiesWithDetail: 1105 });
    expect(html).toContain("1234 runs stored");
    expect(html).toContain("1105 with detail");
    expect(html).not.toContain("1000 runs stored");
    expect(html).not.toContain("1000 with detail");
  });
  it("preserves explicit zero totals rather than falling back to the activity list", () => {
    const html = render({ totalActivities: 0, activitiesWithDetail: 0 });
    expect(html).toContain("0 runs stored");
    expect(html).toContain("0 with detail");
    expect(render({ activities: [], totalActivities: 0, activitiesWithDetail: 0 })).toContain("0 runs stored");
  });
  it("supports older responses without totals during a rolling rollout", () => {
    const html = render();
    expect(html).toContain("1000 runs stored");
    expect(html).toContain("1000 with detail");
  });
});
