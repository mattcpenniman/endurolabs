/** The run control sends saved snapshots and surfaces errors/success without stale badges. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GarminWorkoutSyncButton } from "@/app/components/plan/GarminWorkoutSyncButton";
import type { Workout } from "@/lib/training/models";
import type { PlanSyncEntry } from "@/lib/garmin/plan-sync-status";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const workout: Workout = { id: "easy-w1", type: "easy", title: "Easy", description: "Easy", totalDistance: 5,
  estimatedDuration: 40, weeklyMileageContribution: 5, intensityCategory: "easy",
  segments: [{ type: "easy", distance: 5, pace: 8, description: "Easy" }] };
const mounted: Array<ReturnType<typeof createRoot>> = [];
afterEach(async () => {
  for (const root of mounted.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.unstubAllGlobals();
});
async function mount(selected = workout) {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); mounted.push(root);
  await act(async () => root.render(<GarminWorkoutSyncButton planId="plan-a" date="2027-02-16" workout={selected} />));
  return { node, root };
}
function response(entries: PlanSyncEntry[]) {
  return { ok: true, json: async () => ({ entries, removedExports: 0 }) };
}
const synced: PlanSyncEntry = { workout, date: "2027-02-16", status: "synced",
  syncedAt: "2026-10-25T15:36:20.079Z", url: "https://connect.garmin.com/modern/workout/42" };
describe("Garmin sync control", () => {
  it("sends the selected run's saved snapshot, shows verified link, and clears it after an edit", async () => {
    const fetcher = vi.fn().mockImplementation((_url, options) => Promise.resolve(options?.method === "POST"
      ? { ok: true, json: async () => ({ verified: true, url: synced.url }) }
      : response([])));
    vi.stubGlobal("fetch", fetcher);
    const { node, root } = await mount();
    await act(async () => node.querySelector("button")!.click());
    const post = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(post[0]).toBe("/api/plan/plan-a/garmin-workout");
    expect(JSON.parse(post[1].body)).toEqual({ workoutId: "easy-w1", date: "2027-02-16", target: "pace", expectedWorkout: workout });
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
  it("loads the saved badge, link and verification time after remount without sending a workout", async () => {
    const fetcher = vi.fn().mockResolvedValue(response([synced]));
    vi.stubGlobal("fetch", fetcher);
    const first = await mount();
    expect(first.node.textContent).toContain("Synced");
    await act(async () => first.root.unmount());
    mounted.splice(mounted.indexOf(first.root), 1);
    const { node } = await mount();
    expect(node.textContent).toContain("Synced");
    expect(node.textContent).toContain("Last verified");
    expect(node.querySelector("button")?.textContent).toBe("Resync to Garmin");
    expect(node.querySelector("a")?.href).toBe(synced.url);
    expect(fetcher).toHaveBeenLastCalledWith("/api/plan/plan-a/garmin-workout?target=pace", { cache: "no-store" });
    expect(fetcher.mock.calls.every(([, options]) => !options.method)).toBe(true);
  });
  it("refreshes durable status after successful sync", async () => {
    let sent = false;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_url, options) => {
      if (options?.method === "POST") {
        sent = true;
        return Promise.resolve({ ok: true, json: async () => ({ verified: true, url: synced.url }) });
      }
      return Promise.resolve(response(sent ? [synced] : [{ ...synced, status: "not_synced", url: undefined, syncedAt: undefined }]));
    }));
    const { node } = await mount();
    expect(node.textContent).toContain("Not synced");
    await act(async () => node.querySelector("button")!.click());
    expect(node.querySelector("button")?.textContent).toBe("Resync to Garmin");
    expect(node.textContent).toContain("Last verified");
  });
  it("distinguishes a second run, unsaved edits and unsupported target modes", async () => {
    const secondary = { ...workout, id: "second", title: "Second run" };
    const fetcher = vi.fn().mockResolvedValue(response([synced, { workout: secondary, date: synced.date, status: "not_synced" }]));
    vi.stubGlobal("fetch", fetcher);
    const { node } = await mount(secondary);
    expect(node.textContent).toContain("Not synced");
    expect(node.querySelector("a")).toBeNull();
    const edited = await mount({ ...workout, totalDistance: 6 });
    expect(edited.node.textContent).toContain("Save changes before syncing");
    expect(edited.node.querySelector("button")?.textContent).toBe("Sync to Garmin");
    fetcher.mockResolvedValue(response([{ ...synced, status: "unsupported", error: "Segment has no power prescription" }]));
    const select = edited.node.querySelector("select")!;
    await act(async () => { select.value = "power"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fetcher).toHaveBeenLastCalledWith("/api/plan/plan-a/garmin-workout?target=power", { cache: "no-store" });
    expect(edited.node.textContent).toContain("Segment has no power prescription");
  });
  it("keeps status read failures distinct from not synced and can refresh", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("Status temporarily unavailable"));
    vi.stubGlobal("fetch", fetcher);
    const { node } = await mount();
    expect(node.textContent).toContain("Sync status unavailable");
    expect(node.textContent).not.toContain("Not synced");
    fetcher.mockResolvedValue(response([synced]));
    await act(async () => Array.from(node.querySelectorAll("button")).find(b => b.textContent === "Refresh status")!.click());
    expect(node.querySelector("button")?.textContent).toBe("Resync to Garmin");
  });
  it("ignores a late response for the previously selected target mode", async () => {
    let resolvePace!: (value: ReturnType<typeof response>) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => url.endsWith("target=pace")
      ? new Promise<ReturnType<typeof response>>((resolve) => { resolvePace = resolve; })
      : Promise.resolve(response([{ ...synced, status: "changed" }]))));
    const { node } = await mount();
    const select = node.querySelector("select")!;
    await act(async () => { select.value = "power"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(node.textContent).toContain("Changed since sync");
    await act(async () => resolvePace(response([synced])));
    expect(node.textContent).toContain("Changed since sync");
    expect(node.querySelector("button")?.textContent).toBe("Sync to Garmin");
  });
  it("compares saved prescriptions independent of JSON property order", async () => {
    const reordered = Object.fromEntries(Object.entries(workout).reverse()) as unknown as Workout;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([{ ...synced, workout: reordered }])));
    const { node } = await mount();
    expect(node.querySelector("button")?.textContent).toBe("Resync to Garmin");
    expect(node.textContent).not.toContain("Save changes before syncing");
  });
});
