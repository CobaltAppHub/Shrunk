import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM, output = base64(iv | tag | ciphertext).
export function encrypt(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function decrypt(enc: string, keyB64: string): string {
  const buf = Buffer.from(enc, "base64");
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyB64, "base64"), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}
