/** Steps badges and lazy weekly history tolerate missing data, busy sync and future days. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyStepsBadge, DailyStepsRefreshNote, WeeklyStepsBadge, useDailySteps } from "@/app/components/plan/DailySteps";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 25, 12));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});
function Harness({ dates, enabled = true }: { dates: string[]; enabled?: boolean }): React.JSX.Element {
  const state = useDailySteps(dates, enabled);
  return <div><WeeklyStepsBadge dates={dates} totals={state.totals} />{dates.map((date) => <DailyStepsBadge key={date} steps={state.totals[date]} />)}<span>{state.error}</span><button onClick={state.refresh}>Retry steps</button></div>;
}
async function mount(dates: string[], enabled = true) {
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node); roots.push(root);
  await act(async () => root.render(<Harness dates={dates} enabled={enabled} />));
  return { node, root };
}
describe("Garmin daily steps UI", () => {
  it("omits unknown totals, preserves zero and identifies today's incomplete total accessibly", () => {
    expect(renderToStaticMarkup(<DailyStepsBadge steps={undefined} />)).toBe("");
    expect(renderToStaticMarkup(<DailyStepsBadge steps={0} />)).toContain("0 steps");
    const html = renderToStaticMarkup(<DailyStepsBadge steps={12345} today />);
    expect(html).toContain("12,345 steps so far today"); expect(html).toContain("Includes steps during runs");
    const note = renderToStaticMarkup(<DailyStepsRefreshNote />);
    expect(note).toContain("hourly"); expect(note).toContain("local midnight"); expect(note).toContain("Garmin Connect");
  });
  it("loads one range, shows saved history on failure and permits explicit retry", async () => {
    let fail = true;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { ok: true, json: async () => ({ days: [{ localDate: "2025-01-01", totalSteps: 1000 }] }) };
      return fail ? { ok: false, json: async () => ({ error: "Garmin is syncing" }) }
        : { ok: true, json: async () => ({ days: [{ localDate: "2025-01-01", totalSteps: 2000 }, { localDate: "2025-01-02", totalSteps: 0 }] }) };
    });
    vi.stubGlobal("fetch", fetcher);
    const { node } = await mount(["2025-01-01", "2025-01-02"]);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(node.textContent).toContain("1,000 steps"); expect(node.textContent).toContain("Garmin is syncing");
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ startDate: "2025-01-01", endDate: "2025-01-02" });
    fail = false; await act(async () => node.querySelector("button")!.click());
    expect(node.textContent).toContain("2,000 steps"); expect(node.textContent).toContain("0 steps"); expect(node.textContent).not.toContain("Garmin is syncing");
  });
  it("renders weekly totals, rounded known-day averages and partial coverage accessibly", () => {
    const dates = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];
    const html = renderToStaticMarkup(<WeeklyStepsBadge dates={dates} totals={{ "2026-11-23": 0, "2026-11-25": 10001 }} />);
    expect(html).toContain("10,001 steps so far");
    expect(html).toContain("5,001 steps/day average");
    expect(html).toContain("2/4 days with data");
    expect(html).toContain("Missing and future days are excluded");
    expect(renderToStaticMarkup(<WeeklyStepsBadge dates={dates} totals={{}} />)).toBe("");
  });
  it("does not request collapsed/unsaved views or future history", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await mount(["2025-01-01"], false); await mount(["2999-01-01"]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never displays a late response for a different week", async () => {
    let resolve: (value: unknown) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(() => new Promise((done) => { resolve = done; })));
    const { node, root } = await mount(["2025-01-01"]);
    await act(async () => root.render(<Harness dates={["2999-01-01"]} />));
    await act(async () => resolve({ ok: true, json: async () => ({ days: [{ localDate: "2025-01-01", totalSteps: 9999 }] }) }));
    expect(node.textContent).not.toContain("9,999");
  });

  function mockImports(): ReturnType<typeof vi.fn> {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => ({
      days: [{ localDate: "2026-11-25", totalSteps: init?.method === "POST" ? 22008 : 18447 }],
    }) }));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("refreshes hourly, not at the server's 15-minute cache interval", async () => {
    const fetcher = mockImports();
    const { node } = await mount(["2026-11-25"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000 - 1));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(node.textContent).toContain("22,008 steps");
    expect(node.textContent).toContain("22,008 steps/day avg");
  });

  it("refreshes at local midnight and includes the new day without losing yesterday", async () => {
    vi.setSystemTime(new Date(2026, 10, 25, 23, 50));
    const fetcher = mockImports();
    await mount(["2026-11-25", "2026-11-26"]);
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ startDate: "2026-11-25", endDate: "2026-11-25" });
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string)).toEqual({ startDate: "2026-11-25", endDate: "2026-11-26" });
  });

  it("reimports the displayed last day even if the new day belongs to another week", async () => {
    vi.setSystemTime(new Date(2026, 10, 29, 23, 59));
    const fetcher = mockImports();
    await mount(["2026-11-29"]);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string)).toEqual({ startDate: "2026-11-29", endDate: "2026-11-29" });
  });

  it("pauses when hidden and catches up only once on return, including across midnight", async () => {
    vi.setSystemTime(new Date(2026, 10, 25, 23, 50));
    const fetcher = mockImports();
    await mount(["2026-11-25", "2026-11-26"]);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => vi.advanceTimersByTimeAsync(3 * 60 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(JSON.parse(fetcher.mock.calls[3][1]!.body as string).endDate).toBe("2026-11-26");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not refresh early on visibility return or request while initially hidden", async () => {
    const fetcher = mockImports();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await mount(["2026-11-25"]);
    expect(fetcher).not.toHaveBeenCalled();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(30 * 60_000));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cleans up timers on collapse and unmount", async () => {
    const fetcher = mockImports();
    const { root, node } = await mount(["2026-11-25"]);
    await act(async () => root.render(<Harness dates={["2026-11-25"]} enabled={false} />));
    expect(node.textContent).toContain("22,008 steps/day avg");
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => root.render(<Harness dates={["2026-11-25"]} />));
    expect(fetcher).toHaveBeenCalledTimes(4);
    await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1);
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap a slow import and retains saved totals on automatic failure", async () => {
    let finish: (value: unknown) => void = () => {};
    let posts = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return { ok: true, json: async () => ({ days: [{ localDate: "2026-11-25", totalSteps: 18447 }] }) };
      posts++;
      if (posts === 1) return new Promise((resolve) => { finish = resolve; });
      return { ok: false, json: async () => ({ error: "Garmin is syncing" }) };
    });
    vi.stubGlobal("fetch", fetcher);
    const { node } = await mount(["2026-11-25"]);
    await act(async () => vi.advanceTimersByTimeAsync(2 * 60 * 60_000));
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(posts).toBe(1);
    await act(async () => finish({ ok: true, json: async () => ({ days: [{ localDate: "2026-11-25", totalSteps: 22008 }] }) }));
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(posts).toBe(2);
    expect(node.textContent).toContain("18,447 steps"); expect(node.textContent).toContain("Garmin is syncing");
    await act(async () => vi.advanceTimersByTimeAsync(60 * 60_000 - 1));
    expect(posts).toBe(2);
  });
});
