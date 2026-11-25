import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export function encodeBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/g, "").replace(/[\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error("Mã bí mật TOTP không đúng định dạng Base32.");
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(byteLength = 20): string {
  return encodeBase32(crypto.randomBytes(byteLength));
}

export function buildOtpAuthUri(params: {
  secret: string;
  accountEmail: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? "Bifrost";
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(params.accountEmail)}`;
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

export function generateTotpCode(secret: string, timestampMs = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(timestampMs / 1000 / TOTP_STEP_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** TOTP_DIGITS;
  return String(otp).padStart(TOTP_DIGITS, "0");
}

export function verifyTotpCode(
  secret: string,
  rawCode: string,
  window = 1,
  timestampMs = Date.now(),
): boolean {
  const code = rawCode.trim();
  if (!/^\d{6}$/.test(code)) return false;

  const codeBuf = Buffer.from(code, "utf8");
  for (let offset = -window; offset <= window; offset += 1) {
    const stepMs = timestampMs + offset * TOTP_STEP_SECONDS * 1000;
    const expected = generateTotpCode(secret, stepMs);
    const expectedBuf = Buffer.from(expected, "utf8");
    if (expectedBuf.length === codeBuf.length && crypto.timingSafeEqual(expectedBuf, codeBuf)) {
      return true;
    }
  }
  return false;
}

function hashRecoveryCode(normalizedCode: string): string {
  return crypto.createHash("sha256").update(normalizedCode).digest("hex");
}

export function normalizeRecoveryCode(rawCode: string): string {
  return rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateRecoveryCodes(count = 8): { rawCodes: string[]; hashes: string[] } {
  const rawCodes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const partA = crypto.randomBytes(2).toString("hex").toUpperCase();
    const partB = crypto.randomBytes(2).toString("hex").toUpperCase();
    const formatted = `${partA}-${partB}`;
    rawCodes.push(formatted);
    hashes.push(hashRecoveryCode(`${partA}${partB}`));
  }
  return { rawCodes, hashes };
}

export function consumeRecoveryCode(
  rawCode: string,
  storedHashes: string[],
): { matched: boolean; remainingHashes: string[] } {
  const normalized = normalizeRecoveryCode(rawCode);
  if (normalized.length < 8) {
    return { matched: false, remainingHashes: storedHashes };
  }
  const candidateHash = hashRecoveryCode(normalized);
  const candidateBuf = Buffer.from(candidateHash, "utf8");

  let matchedIndex = -1;
  for (let i = 0; i < storedHashes.length; i += 1) {
    const storedBuf = Buffer.from(storedHashes[i], "utf8");
    if (storedBuf.length === candidateBuf.length && crypto.timingSafeEqual(storedBuf, candidateBuf)) {
      matchedIndex = i;
      break;
    }
  }

  if (matchedIndex === -1) {
    return { matched: false, remainingHashes: storedHashes };
  }

  return {
    matched: true,
    remainingHashes: storedHashes.filter((_, idx) => idx !== matchedIndex),
  };
}
