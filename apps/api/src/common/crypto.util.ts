import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

/**
 * Security token utilities. Raw high-entropy tokens are returned to the caller
 * exactly once; only their SHA-256 hash is persisted, so a database leak does
 * not reveal usable tokens. Comparison is constant-time.
 */

/** Generate a URL-safe opaque token (default 32 bytes ≈ 256 bits). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest — used for refresh/reset/activation token handles. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Constant-time comparison of two hex digests of equal length. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Numeric OTP of the given length (default 6). Uses rejection-free
 * crypto.randomInt for uniform distribution. Returned to the caller to be
 * delivered over a trusted channel; only its hash is stored.
 */
export function generateNumericOtp(length = 6): string {
  let otp = '';
  for (let i = 0; i < length; i++) otp += randomInt(0, 10).toString();
  return otp;
}
