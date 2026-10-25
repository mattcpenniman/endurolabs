/** Full-plan UI verifies sequential doubles, durable partial resume and changed-plan status. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminPlanSyncCard } from "@/app/components/plan/GarminPlanSyncCard";
import type { PlanSyncEntry } from "@/lib/garmin/plan-sync-status";
import type { MarathonPlan, Workout } from "@/lib/training/models";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const workout: Workout = { id: "am", type: "easy", title: "Main run", description: "Easy", totalDistance: 5,
  estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: "easy",
  segments: [{ type: "easy", distance: 5, pace: 8, description: "Easy" }] };
const plan = { id: "plan-a", weeks: [{ days: [{ date: "2027-02-16", workout, secondaryWorkout: { ...workout, id: "pm" } }] }] } as MarathonPlan;
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.unstubAllGlobals();
});
async function mount() {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); mounted.push(root);
  await act(async () => root.render(<GarminPlanSyncCard plan={plan} />));
  return { node, root };
}
function backend(options: { failSecondary?: boolean; unsupported?: boolean } = {}) {
  let fail = options.failSecondary;
  const posts: string[] = [];
  let active = 0;
  let maxActive = 0;
  const entries: PlanSyncEntry[] = ["am", "pm"].map((id) => ({ workout: { ...workout, id }, date: "2027-02-16", status: "not_synced" }));
  if (options.unsupported) { entries[1].status = "unsupported"; entries[1].error = "Segment has no power prescription"; }
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== "POST") return { ok: true, json: async () => ({ entries: structuredClone(entries), removedExports: 0 }) };
    const body = JSON.parse(init.body as string);
    const entry = entries.find((item) => item.workout.id === body.workoutId)!;
    posts.push(body.workoutId);
    active++; maxActive = Math.max(active, maxActive);
    await Promise.resolve();
    active--;
    if (fail && body.workoutId === "pm") {
      fail = false;
      return { ok: false, json: async () => ({ error: "Garmin request failed. Sync again to reconcile." }) };
    }
    entry.status = "synced"; entry.syncedAt = "2026-10-25T12:00:00Z";
    return { ok: true, json: async () => ({ verified: true }) };
  });
  vi.stubGlobal("fetch", fetcher);
  return { entries, posts, fetcher, maxActive: () => maxActive };
}
describe("Garmin full-plan Settings control", () => {
  it("sends the main run before the secondary, with saved snapshots, and restores status after remount", async () => {
    const api = backend();
    const { node, root } = await mount();
    await act(async () => node.querySelector("button")!.click());
    expect(api.posts).toEqual(["am", "pm"]);
    expect(api.maxActive()).toBe(1);
    const writes = api.fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(writes[0][1]!.body as string)).toMatchObject({ workoutId: "am", expectedWorkout: workout, target: "pace", date: "2027-02-16" });
    expect(node.textContent).toContain("2 of 2 workouts synced");
    expect(node.textContent).toContain("Last verified");
    expect(node.querySelector("button")!.textContent).toBe("Resync full plan");
    await act(async () => root.render(<div />));
    await act(async () => root.render(<GarminPlanSyncCard plan={plan} />));
    expect(node.textContent).toContain("2 of 2 workouts synced");
  });
  it("stops on provider failure and resumes only remaining runs on retry", async () => {
    const api = backend({ failSecondary: true });
    const { node } = await mount();
    await act(async () => node.querySelector("button")!.click());
    expect(api.posts).toEqual(["am", "pm"]);
    expect(node.textContent).toContain("1 of 2 workouts synced");
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("reconcile");
    await act(async () => node.querySelector("button")!.click());
    expect(api.posts).toEqual(["am", "pm", "pm"]);
    expect(node.textContent).toContain("2 of 2 workouts synced");
  });
  it("refreshes changed-plan status and resyncs just the changed prescription", async () => {
    const api = backend();
    const { node, root } = await mount();
    await act(async () => node.querySelector("button")!.click());
    api.entries[0].status = "changed";
    api.entries[0].workout = { ...workout, title: "Updated" };
    const edited = structuredClone(plan); edited.weeks[0].days[0].workout!.title = "Updated";
    await act(async () => root.render(<GarminPlanSyncCard plan={edited} />));
    expect(node.textContent).toContain("1 changed since sync");
    await act(async () => node.querySelector("button")!.click());
    expect(api.posts).toEqual(["am", "pm", "am"]);
    expect(node.textContent).toContain("2 of 2 workouts synced");
  });
  it("preflights every prescription before writing any workout", async () => {
    const api = backend({ unsupported: true });
    const { node } = await mount();
    await act(async () => node.querySelector("button")!.click());
    expect(api.posts).toEqual([]);
    expect(node.querySelector('[role="alert"]')?.textContent).toContain("no power prescription");
  });
});
