import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEncryptionKey } from "../config/env";

/** Encrypts a webhook signing secret with AES-256-GCM. Format: v1:iv:tag:ct (base64). */
export function encryptSecret(plain: string): string {
  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(encrypted: string): string {
  const [version, ivB64, tagB64, ctB64] = encrypted.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !ctB64) {
    throw new Error("Unsupported secret ciphertext format");
  }
  const key = requireEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Secret is 32 bytes of CSPRNG output, hex-encoded (256 bits). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("hex");
}
