/** Steps badges and lazy weekly history tolerate missing data, busy sync and future days. */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyStepsBadge, useDailySteps } from "@/app/components/plan/DailySteps";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function Harness({ dates, enabled = true }: { dates: string[]; enabled?: boolean }): React.JSX.Element {
  const state = useDailySteps(dates, enabled);
  return <div>{dates.map((date) => <DailyStepsBadge key={date} steps={state.totals[date]} />)}<span>{state.error}</span><button onClick={state.refresh}>Retry steps</button></div>;
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
});
