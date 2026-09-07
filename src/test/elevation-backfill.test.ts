// ============================================================
// EnduroLab - Open-Elevation Backfill Tests
// ============================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLookupUrl,
  chunk,
  fetchElevations,
  LookupPoint,
  OpenElevationError,
  parseLookupResults,
} from "@/lib/courses/elevation-backfill";

const POINTS: LookupPoint[] = [
  { latitude: 52.515214, longitude: 13.3602 },
  { latitude: 52.515052, longitude: 13.350253 },
  { latitude: 52.52, longitude: 13.405 },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chunk", () => {
  it("splits into batches of the given size", () => {
    const batches = chunk([1, 2, 3, 4, 5], 2);
    expect(batches).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 50)).toEqual([]);
    expect(chunk([1], 50)).toEqual([[1]]);
  });
});

describe("buildLookupUrl", () => {
  it("builds the locations parameter preserving order", () => {
    const url = buildLookupUrl(POINTS, "https://elev.test");
    const locations = new URL(url).searchParams.get("locations");
    expect(locations).toBe("52.5152140,13.3602000|52.5150520,13.3502530|52.5200000,13.4050000");
  });

  it("trims trailing slashes from the base URL", () => {
    const url = buildLookupUrl([POINTS[0]], "https://elev.test///");
    expect(url).toContain("https://elev.test/api/v1/lookup");
    expect(url).not.toContain("//api");
  });
});

describe("parseLookupResults", () => {
  it("accepts a well-formed ordered response", () => {
    const body = {
      results: [
        { latitude: 52.515214, longitude: 13.3602, elevation: 30.2 },
        { latitude: 52.515052, longitude: 13.350253, elevation: 28.9 },
        { latitude: 52.52, longitude: 13.405, elevation: 34.1 },
      ],
    };
    expect(parseLookupResults(body, POINTS)).toEqual([30.2, 28.9, 34.1]);
  });

  it("rejects a length mismatch", () => {
    const body = {
      results: [{ latitude: 52.515214, longitude: 13.3602, elevation: 30.2 }],
    };
    expect(() => parseLookupResults(body, POINTS)).toThrow(OpenElevationError);
  });

  it("rejects a coordinate mismatch (silent reorder)", () => {
    const body = {
      results: [
        { latitude: 52.52, longitude: 13.405, elevation: 34.1 },
        { latitude: 52.515214, longitude: 13.3602, elevation: 30.2 },
        { latitude: 52.515052, longitude: 13.350253, elevation: 28.9 },
      ],
    };
    expect(() => parseLookupResults(body, POINTS)).toThrow(/point 1/i);
  });

  it("rejects missing or non-finite elevation", () => {
    const body = {
      results: [
        { latitude: 52.515214, longitude: 13.3602 },
        { latitude: 52.515052, longitude: 13.350253, elevation: 28.9 },
        { latitude: 52.52, longitude: 13.405, elevation: NaN },
      ],
    };
    expect(() => parseLookupResults(body, POINTS)).toThrow(OpenElevationError);
  });

  it("rejects a non-object body", () => {
    expect(() => parseLookupResults("502 Bad Gateway", POINTS)).toThrow(OpenElevationError);
    expect(() => parseLookupResults(null, POINTS)).toThrow(OpenElevationError);
  });
});

describe("fetchElevations", () => {
  function fakeFetch(
    handler: (url: string) => Promise<Response> | Response,
  ): void {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(handler(String(input))),
    );
  }

  function orderedResponse(url: string): Response {
    const locations = new URL(url).searchParams.get("locations") ?? "";
    const results = locations
      .split("|")
      .map((pair) => {
        const [lat, lon] = pair.split(",").map(Number);
        return { latitude: lat, longitude: lon, elevation: 100.5 };
      });
    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("returns elevations in request order", async () => {
    fakeFetch(orderedResponse);
    const elevations = await fetchElevations(POINTS);
    expect(elevations).toEqual([100.5, 100.5, 100.5]);
  });

  it("batches large point sets into multiple API calls", async () => {
    fakeFetch(orderedResponse);
    const many: LookupPoint[] = Array.from({ length: 130 }, (_, i) => ({
      latitude: 52 + i * 1e-6,
      longitude: 13.4,
    }));
    const elevations = await fetchElevations(many);
    expect(elevations).toHaveLength(130);
    // 130 points at 50/batch = 3 requests (50+50+30).
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("propagates rate limits as a typed error (all-or-nothing)", async () => {
    fakeFetch(() => new Response("Too Many Requests", { status: 429 }));
    await expect(
      fetchElevations(POINTS, { retryDelaysMs: [] }),
    ).rejects.toMatchObject({
      status: "rate_limited",
      name: "OpenElevationError",
    });
  });

  it("propagates HTTP errors as a typed error", async () => {
    fakeFetch(() => new Response("Bad Gateway", { status: 502 }));
    await expect(
      fetchElevations(POINTS, { retryDelaysMs: [] }),
    ).rejects.toMatchObject({
      status: "http_error",
      name: "OpenElevationError",
    });
  });

  it("wraps network failures as a typed error", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    await expect(
      fetchElevations(POINTS, { retryDelaysMs: [] }),
    ).rejects.toMatchObject({
      status: "network",
      name: "OpenElevationError",
    });
  });

  it("stops at the first failed batch (no partial persistence possible)", async () => {
    let calls = 0;
    fakeFetch((url) => {
      calls += 1;
      if (calls === 2) return new Response("error", { status: 503 });
      return orderedResponse(url);
    });
    const many: LookupPoint[] = Array.from({ length: 130 }, (_, i) => ({
      latitude: 52 + i * 1e-6,
      longitude: 13.4,
    }));
    await expect(
      fetchElevations(many, { retryDelaysMs: [], interBatchDelayMs: 0 }),
    ).rejects.toMatchObject({ name: "OpenElevationError" });
  });

  it("retries a transient throttle and then succeeds", async () => {
    let calls = 0;
    fakeFetch((url) => {
      calls += 1;
      if (calls === 1) return new Response("Too Many Requests", { status: 429 });
      return orderedResponse(url);
    });
    await expect(
      fetchElevations(POINTS, { retryDelaysMs: [0] }),
    ).resolves.toEqual([100.5, 100.5, 100.5]);
    expect(calls).toBe(2);
  });

  it("returns no values for an empty request", async () => {
    await expect(fetchElevations([])).resolves.toEqual([]);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

// (no merge helper: the route performs preserve-existing/ fill-missing
//  inline so a partially-elevated GPX never has real values overwritten.)
