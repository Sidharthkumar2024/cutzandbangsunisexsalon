import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, SmtpEmailProvider } from "@cutz/providers";

const previousKey = process.env.SECRETS_KEY;
const previousNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (previousKey === undefined) delete process.env.SECRETS_KEY;
  else process.env.SECRETS_KEY = previousKey;
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe("provider secret encryption", () => {
  it("round-trips a secret without storing it as plaintext", () => {
    process.env.SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret("smtp-password-123");

    expect(encrypted).not.toContain("smtp-password-123");
    expect(decryptSecret(encrypted)).toBe("smtp-password-123");
  });

  it("uses a random nonce for each encrypted value", () => {
    process.env.SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");
    const first = encryptSecret("same-value");
    const second = encryptSecret("same-value");

    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("same-value");
    expect(decryptSecret(second)).toBe("same-value");
  });

  it("rejects a weak production key", () => {
    process.env.NODE_ENV = "production";
    process.env.SECRETS_KEY = "not-a-valid-32-byte-base64-key";
    expect(() => encryptSecret("value")).toThrow("secrets_key_must_be_32_bytes_base64");
  });

  it("fails closed when production SMTP is not configured", async () => {
    process.env.NODE_ENV = "production";
    const provider = new SmtpEmailProvider({ enabled: false });
    await expect(provider.send({ to: "test@example.com", subject: "Test", html: "<p>Test</p>" })).resolves.toMatchObject({ status: "failed", error: "smtp_not_configured" });
  });
});
