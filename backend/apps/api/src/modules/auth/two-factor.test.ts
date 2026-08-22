import { describe, expect, it } from "vitest";
import {
  buildOtpAuthUri,
  findRecoveryCodeHash,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpCode,
  verifyTotp,
} from "./two-factor.js";

describe("TOTP two-factor authentication", () => {
  it("generates a Google Authenticator-compatible code", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const now = 1_700_000_000_000;
    const code = totpCode(secret, now);
    expect(code).toMatch(/^\d{6}$/u);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(code === "000000");
  });

  it("accepts a one-step clock drift but rejects older codes", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
  });

  it("builds an otpauth URI without leaking the secret into the label", () => {
    const uri = buildOtpAuthUri({ secret: "ABC234", account: "owner@example.com" });
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain("secret=ABC234");
    expect(uri).toContain("issuer=Cutz+%26+Bangs");
  });

  it("stores only hashed one-time recovery codes", () => {
    const [code] = generateRecoveryCodes(1);
    const hash = hashRecoveryCode(code);
    expect(hash).not.toContain(code.replaceAll("-", ""));
    expect(findRecoveryCodeHash(code.toLowerCase(), [hash])).toBe(hash);
    expect(findRecoveryCodeHash("FFFF-FFFF-FFFF-FFFF", [hash])).toBeUndefined();
  });
});
