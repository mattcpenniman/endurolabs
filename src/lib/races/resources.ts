/** Validation and client contracts for private race keepsakes. */
export const MAX_RACE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_RACE_ATTACHMENTS = 10;
export const RACE_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";

export interface RaceAttachmentRecord {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface RaceResourcesResponse {
  resultsUrl: string | null;
  attachments: RaceAttachmentRecord[];
}

export function parseResultsUrl(value: unknown): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2048) throw new Error("Enter a results URL of at most 2048 characters");
  if (!value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a complete http:// or https:// results URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter a complete http:// or https:// results URL without credentials");
  }
  return url.href;
}

export function validateRaceAttachment(filename: string, bytes: Uint8Array): { filename: string; contentType: string } {
  if (bytes.length === 0 || bytes.length > MAX_RACE_ATTACHMENT_BYTES) throw new Error("Choose a non-empty file up to 15 MB");
  const safeName = filename.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(-180) || "attachment";
  const starts = (...signature: number[]): boolean => signature.every((byte, index) => bytes[index] === byte);
  if (/\.pdf$/i.test(safeName) && starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return { filename: safeName, contentType: "application/pdf" };
  if (/\.jpe?g$/i.test(safeName) && starts(0xff, 0xd8, 0xff)) return { filename: safeName, contentType: "image/jpeg" };
  if (/\.png$/i.test(safeName) && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { filename: safeName, contentType: "image/png" };
  throw new Error("Choose a PDF, JPEG, or PNG file with matching file contents");
}
