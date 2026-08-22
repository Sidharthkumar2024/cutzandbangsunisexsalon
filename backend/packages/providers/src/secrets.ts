import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey() {
  const configured = process.env.SECRETS_KEY?.trim();
  if (configured) {
    const decoded = Buffer.from(configured, "base64");
    if (decoded.length === 32) return decoded;
    if (process.env.NODE_ENV === "production") throw new Error("secrets_key_must_be_32_bytes_base64");
    return createHash("sha256").update(configured).digest();
  }
  if (process.env.NODE_ENV === "production") throw new Error("secrets_key_required");
  return createHash("sha256")
    .update(`cutz-local:${process.env.DATABASE_URL ?? "development"}`)
    .digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function decryptSecret(value?: string | null) {
  if (!value) return undefined;
  const [version, ivRaw, tagRaw, bodyRaw] = value.split(":");
  if (version !== "v1" || !ivRaw || !tagRaw || !bodyRaw) throw new Error("invalid_encrypted_secret");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(bodyRaw, "base64url")), decipher.final()]).toString("utf8");
}
