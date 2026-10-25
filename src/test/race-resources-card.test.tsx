/** Keepsake card loading, link editing, upload feedback, download and removal. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import RaceResourcesCard from "@/app/components/races/RaceResourcesCard";

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("displays a saved results link and certificate, clears the link, and removes a certificate", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ resultsUrl: "https://results.example.com/", attachments: [{ id: "certificate", filename: "finish.pdf", sizeBytes: 2000 }] }) });
  await act(async () => root.render(<RaceResourcesCard activityId="race-a" />));
  expect(container.querySelector('a[target="_blank"]')?.getAttribute("href")).toBe("https://results.example.com/");
  expect(container.querySelector('a[href*="attachments"]')?.getAttribute("href")).toBe("/api/races/race-a/attachments/certificate");
  const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ resultsUrl: null }) });
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(fetchMock.mock.calls[1][1].body).toBe(JSON.stringify({ resultsUrl: "" }));
  expect(container.querySelector('a[target="_blank"]')).toBeNull();
  vi.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove finish.pdf"]')!.click());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/races/race-a/attachments/certificate", { method: "DELETE" });
  expect(container.textContent).toContain("No attachments yet.");
});

it("keeps the current file list and shows upload failures", async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ resultsUrl: null, attachments: [] }) });
  await act(async () => root.render(<RaceResourcesCard activityId="race-b" />));
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Choose a PDF, JPEG, or PNG file" }) });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["bad content"], "fake.pdf")] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(fetchMock.mock.calls[1][0]).toBe("/api/races/race-b/resources");
  expect(fetchMock.mock.calls[1][1].body.get("file").name).toBe("fake.pdf");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Choose a PDF");
  expect(container.textContent).toContain("No attachments yet.");
});
