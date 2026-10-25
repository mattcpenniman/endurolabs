// @vitest-environment node
/** API boundaries: auth, metadata-only lists, upload limits and private download bytes. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "owner" } as { id: string } | null,
  rows: [] as unknown[][],
  writes: [] as unknown[],
  select: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/db/client", () => {
  const database = {
    select: state.select,
    insert: () => ({ values: (value: unknown) => {
      state.writes.push(value);
      return { onConflictDoUpdate: async () => [], returning: async () => [{ id: "attachment", ...value as object }] };
    } }),
    delete: () => ({ where: () => ({ returning: async () => state.rows.shift() ?? [] }) }),
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(database),
  };
  return { db: database };
});

import { GET, PATCH, POST } from "@/app/api/races/[id]/resources/route";
import { GET as download, DELETE as remove } from "@/app/api/races/[id]/attachments/[attachmentId]/route";
import { PgDialect } from "drizzle-orm/pg-core";

const id = "11111111-1111-4111-8111-111111111111";
const attachmentId = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ id, attachmentId }) };
const url = `http://localhost/api/races/${id}/resources`;

beforeEach(() => {
  state.user = { id: "owner" };
  state.rows = [];
  state.writes = [];
  state.select.mockReset();
  state.select.mockImplementation(() => {
    const rows = state.rows.shift() ?? [];
    return { from: () => ({ where: (filter: unknown) => {
      // Keep the predicate observable to verify the real guard scopes ownership.
      state.select.mock.calls[state.select.mock.calls.length - 1].push(filter);
      return { limit: async () => rows, orderBy: async () => rows, for: async () => rows, then: (resolve: (value: unknown) => unknown) => resolve(rows) };
    } }) };
  });
});

describe("private race resources API", () => {
  it("requires authentication for every read and mutation", async () => {
    state.user = null;
    for (const handler of [GET, PATCH, POST, download, remove]) {
      expect((await handler(new Request(url), context)).status).toBe(401);
    }
    expect(state.select).not.toHaveBeenCalled();
    expect(state.writes).toEqual([]);
  });
  it("returns 404 for another account's race and scopes the guard to owner and race type", async () => {
    expect((await GET(new Request(url), context)).status).toBe(404);
    const predicate = state.select.mock.calls[0][1];
    const query = new PgDialect().sqlToQuery(predicate);
    expect(query.params).toEqual([id, "owner", "race"]);
    expect(state.writes).toEqual([]);
  });
  it("lists only attachment metadata and a saved results URL", async () => {
    state.rows = [[{ id }], [{ resultsUrl: "https://example.com/results" }], [{ id: attachmentId, filename: "finish.pdf", sizeBytes: 8, contentType: "application/pdf" }]];
    const response = await GET(new Request(url), context);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ resultsUrl: "https://example.com/results", attachments: [{ id: attachmentId, filename: "finish.pdf", sizeBytes: 8, contentType: "application/pdf" }] });
    expect(Object.keys(state.select.mock.calls[2][0])).not.toContain("contentBase64");
  });
  it("updates and clears a link without modifying prediction records", async () => {
    for (const value of ["https://results.example.com", ""]) {
      state.rows = [[{ id }]];
      const response = await PATCH(new Request(url, { method: "PATCH", body: JSON.stringify({ resultsUrl: value }) }), context);
      expect(response.status).toBe(200);
    }
    expect(state.writes).toEqual([{ activityId: id, resultsUrl: "https://results.example.com/" }, { activityId: id, resultsUrl: null }]);
  });
  it("rejects script links before persistence", async () => {
    state.rows = [[{ id }]];
    expect((await PATCH(new Request(url, { method: "PATCH", body: JSON.stringify({ resultsUrl: "javascript:alert(1)" }) }), context)).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it("persists exact uploaded bytes and enforces the per-race cap", async () => {
    const upload = (): Request => {
      const form = new FormData();
      form.set("file", new File(["%PDF-1.7\ncertificate"], "finish.pdf", { type: "application/octet-stream" }));
      return new Request(url, { method: "POST", body: form });
    };
    state.rows = [[{ id }], [{ id }], []];
    expect((await POST(upload(), context)).status).toBe(201);
    expect(state.writes[0]).toMatchObject({ activityId: id, filename: "finish.pdf", contentType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\ncertificate").toString("base64") });
    state.rows = [[{ id }], [{ id }], Array.from({ length: 10 }, () => ({ id: attachmentId }))];
    expect((await POST(upload(), context)).status).toBe(409);
    expect(state.writes).toHaveLength(1);
  });
  it("rejects oversized streamed bodies before parsing or persistence", async () => {
    state.rows = [[{ id }]];
    expect((await POST(new Request(url, { method: "POST", body: new Uint8Array(5 * 1024 * 1024 + 65537) }), context)).status).toBe(413);
    expect(state.writes).toEqual([]);
  });
  it("downloads exact private bytes and scopes the attachment to the selected race", async () => {
    state.rows = [[{ id }], [{ filename: "Finish certificate.pdf", contentType: "application/pdf", contentBase64: Buffer.from("%PDF-certificate").toString("base64") }]];
    const response = await download(new Request(url), context);
    expect(await response.text()).toBe("%PDF-certificate");
    expect(response.headers.get("content-disposition")).toContain("Finish%20certificate.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const query = new PgDialect().sqlToQuery(state.select.mock.calls[1].at(-1));
    expect(query.params).toEqual([attachmentId, id]);
  });
  it("removes an attachment and reports missing attachments", async () => {
    state.rows = [[{ id }], [{ id: attachmentId }]];
    expect((await remove(new Request(url, { method: "DELETE" }), context)).status).toBe(200);
    state.rows = [[{ id }], []];
    expect((await remove(new Request(url, { method: "DELETE" }), context)).status).toBe(404);
  });
});
