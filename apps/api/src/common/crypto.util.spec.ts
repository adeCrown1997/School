import { generateNumericOtp, generateToken, safeEqualHex, sha256 } from './crypto.util';

/**
 * Security-token utilities. These back activation OTPs, refresh/reset handles and
 * the activation continuation token, so their guarantees (entropy, stable
 * hashing, constant-time comparison that never throws) are safety-critical.
 */
describe('crypto.util', () => {
  describe('generateToken', () => {
    it('produces a URL-safe base64url string with no padding or unsafe chars', () => {
      const t = generateToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t).not.toContain('=');
    });

    it('is effectively unique across calls (high entropy)', () => {
      const seen = new Set(Array.from({ length: 500 }, () => generateToken()));
      expect(seen.size).toBe(500);
    });

    it('honours a custom byte length', () => {
      // 16 bytes → 22 base64url chars (ceil(16*4/3), no padding).
      expect(generateToken(16).length).toBe(22);
    });
  });

  describe('sha256', () => {
    it('matches the known digest of a fixed input', () => {
      expect(sha256('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic and returns a 64-char lowercase hex string', () => {
      const a = sha256('the-same-input');
      const b = sha256('the-same-input');
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('safeEqualHex', () => {
    it('returns true for identical hex digests', () => {
      const h = sha256('secret');
      expect(safeEqualHex(h, h)).toBe(true);
    });

    it('returns false for differing digests of equal length', () => {
      expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    });

    it('returns false (never throws) on length mismatch', () => {
      expect(safeEqualHex('abcd', 'abcdef')).toBe(false);
    });

    it('never throws on non-hex input (callers only ever pass sha256 hex)', () => {
      // Node's hex decoder stops at the first invalid nibble, so it returns a
      // boolean rather than throwing — the guarantee callers rely on.
      expect(typeof safeEqualHex('zz', 'zz')).toBe('boolean');
      // Differing valid-hex prefixes still compare false.
      expect(safeEqualHex('ab', 'cd')).toBe(false);
    });
  });

  describe('generateNumericOtp', () => {
    it('returns 6 digits by default', () => {
      expect(generateNumericOtp()).toMatch(/^\d{6}$/);
    });

    it('honours a custom length', () => {
      expect(generateNumericOtp(8)).toMatch(/^\d{8}$/);
    });

    it('draws from the full 0-9 range across many samples', () => {
      const digits = new Set(
        Array.from({ length: 200 }, () => generateNumericOtp())
          .join('')
          .split(''),
      );
      // Extremely likely to see every digit; guards against a truncated range.
      expect(digits.size).toBe(10);
    });
  });
});
