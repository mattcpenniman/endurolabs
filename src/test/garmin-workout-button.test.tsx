/** The run control sends saved snapshots and surfaces errors/success without stale badges. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminWorkoutSyncButton } from "@/app/components/plan/GarminWorkoutSyncButton";
import type { Workout } from "@/lib/training/models";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const workout: Workout = { id: "easy-w1", type: "easy", title: "Easy", description: "Easy", totalDistance: 5,
  estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: "easy",
  segments: [{ type: "easy", distance: 5, pace: 8, description: "Easy" }] };
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.unstubAllGlobals();
});
async function mount() {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); mounted.push(root);
  await act(async () => root.render(<GarminWorkoutSyncButton planId="plan-a" date="2027-02-16" workout={workout} />));
  return { node, root };
}
describe("Garmin sync control", () => {
  it("sends the selected run's saved snapshot, shows verified link, and clears it after an edit", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ url: "https://connect.garmin.com/modern/workout/42" }) });
    vi.stubGlobal("fetch", fetcher);
    const { node, root } = await mount();
    await act(async () => node.querySelector("button")!.click());
    expect(fetcher.mock.calls[0][0]).toBe("/api/plan/plan-a/garmin-workout");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ workoutId: "easy-w1", date: "2027-02-16", target: "pace", expectedWorkout: workout });
    expect(node.querySelector("a")?.href).toBe("https://connect.garmin.com/modern/workout/42");
    await act(async () => root.render(<GarminWorkoutSyncButton planId="plan-a" date="2027-02-18" workout={workout} />));
    expect(node.querySelector("a")).toBeNull();
  });
  it("shows actionable connection errors and allows retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Connect Garmin in Profile before syncing workouts." }) }));
    const { node } = await mount();
    await act(async () => node.querySelector("button")!.click());
    expect(node.querySelector('[role="status"]')?.textContent).toContain("Connect Garmin in Profile");
    expect(node.querySelector("button")?.disabled).toBe(false);
  });
});
