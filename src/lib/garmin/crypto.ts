// ============================================================
// EnduroLab - Garmin Token Encryption
// ============================================================

import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function encryptionKey(): Buffer {
  const secret = process.env.GARMIN_TOKEN_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("GARMIN_TOKEN_ENCRYPTION_KEY must contain at least 32 characters");
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptGarminTokens(tokens: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((value) => value.toString("base64url")).join(".");
}

export function decryptGarminTokens<T>(encrypted: string): T {
  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid Garmin token payload");

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
