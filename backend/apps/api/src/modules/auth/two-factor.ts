import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeBase32(input: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(input: string) {
  const clean = input.toUpperCase().replace(/=+$/u, "").replace(/\s+/gu, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("invalid_base32_secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

export function buildOtpAuthUri(input: {
  secret: string;
  account: string;
  issuer?: string;
}) {
  const issuer = input.issuer?.trim() || "Cutz & Bangs";
  const label = `${issuer}:${input.account}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

export function totpCode(secret: string, nowMs = Date.now()) {
  const counter = BigInt(Math.floor(nowMs / 30_000));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, supplied: string, nowMs = Date.now()) {
  const code = supplied.replace(/\s+/gu, "");
  if (!/^\d{6}$/u.test(code)) return false;
  const actual = Buffer.from(code);
  for (const offset of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, nowMs + offset * 30_000));
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return true;
  }
  return false;
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-F0-9]/gu, "");
}

export function hashRecoveryCode(code: string) {
  return createHash("sha256")
    .update(`cutz-2fa-recovery:${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(8).toString("hex").toUpperCase();
    return raw.match(/.{1,4}/gu)?.join("-") ?? raw;
  });
}

export function findRecoveryCodeHash(code: string, hashes: string[]) {
  const candidate = Buffer.from(hashRecoveryCode(code), "hex");
  return hashes.find((hash) => {
    const stored = Buffer.from(hash, "hex");
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  });
}
