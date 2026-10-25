/** Race resource input boundaries and file content checks. */
import { describe, expect, it } from "vitest";
import { MAX_RACE_ATTACHMENT_BYTES, parseResultsUrl, validateRaceAttachment } from "@/lib/races/resources";

describe("race resources", () => {
  it("normalizes links and explicitly clears saved links", () => {
    expect(parseResultsUrl(" https://results.example.com/race?id=42 ")).toBe("https://results.example.com/race?id=42");
    for (const value of [null, "", "  "]) expect(parseResultsUrl(value)).toBeNull();
    expect(parseResultsUrl("http://results.example.com")).toBe("http://results.example.com/");
  });
  it.each(["javascript:alert(1)", "data:text/html,test", "ftp://example.com", "//example.com", "example.com", "https://user:password@example.com", undefined, 42, "https://example.com/" + "a".repeat(2048)])("rejects unsafe or invalid links: %s", (value) => {
    expect(() => parseResultsUrl(value)).toThrow();
  });
  it("checks file signatures instead of trusting browser MIME types", () => {
    expect(validateRaceAttachment("certificate.PDF", new TextEncoder().encode("%PDF-1.7"))).toEqual({ filename: "certificate.PDF", contentType: "application/pdf" });
    expect(validateRaceAttachment("photo.jpeg", new Uint8Array([255, 216, 255, 0]))).toMatchObject({ contentType: "image/jpeg" });
    expect(validateRaceAttachment("photo.png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toMatchObject({ contentType: "image/png" });
    expect(() => validateRaceAttachment("fake.pdf", new TextEncoder().encode("<html>"))).toThrow("matching file contents");
    expect(() => validateRaceAttachment("fake.svg", new TextEncoder().encode("%PDF-1.7"))).toThrow();
  });
  it("bounds size and strips paths and header controls from filenames", () => {
    const bytes = new Uint8Array(MAX_RACE_ATTACHMENT_BYTES);
    bytes.set([255, 216, 255]);
    expect(validateRaceAttachment("C:\\photos\\finish\r\n.jpg", bytes).filename).toBe("finish.jpg");
    expect(() => validateRaceAttachment("a.jpg", new Uint8Array())).toThrow("non-empty");
    expect(() => validateRaceAttachment("a.jpg", new Uint8Array(MAX_RACE_ATTACHMENT_BYTES + 1))).toThrow("15 MB");
  });
});
