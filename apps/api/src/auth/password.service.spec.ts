import { ConfigService } from '@nestjs/config';
import { PasswordService } from './password.service';

/**
 * Password policy + hashing. The strength rules are business-layer enforcement
 * (in addition to DTO validation) so no path can persist a weak password, and
 * the hash/verify round-trip must use argon2id and reject tampered hashes.
 */
function service(minLength = 12): PasswordService {
  const config = { get: jest.fn().mockReturnValue(minLength) } as unknown as ConfigService;
  return new PasswordService(config);
}

describe('PasswordService', () => {
  describe('validateStrength', () => {
    const svc = service(12);

    it('accepts a strong password (no violations)', () => {
      expect(svc.validateStrength('Str0ng&Passw0rd!')).toEqual([]);
    });

    it('flags a password shorter than the configured minimum', () => {
      const errors = svc.validateStrength('Ab1!xy');
      expect(errors.some((e) => /at least 12 characters/.test(e))).toBe(true);
    });

    it('requires each character class', () => {
      expect(svc.validateStrength('alllowercase1!')).toContain(
        'Password must include an uppercase letter',
      );
      expect(svc.validateStrength('ALLUPPERCASE1!')).toContain(
        'Password must include a lowercase letter',
      );
      expect(svc.validateStrength('NoDigitsHere!!')).toContain('Password must include a digit');
      expect(svc.validateStrength('NoSymbols12345')).toContain('Password must include a symbol');
    });

    it('rejects a single repeated character', () => {
      expect(svc.validateStrength('aaaaaaaaaaaaaa')).toContain(
        'Password must not be a single repeated character',
      );
    });

    it('rejects common leading patterns regardless of case', () => {
      expect(svc.validateStrength('Password123!extra')).toContain('Password is too common');
      expect(svc.validateStrength('qwertyKeyboard1!')).toContain('Password is too common');
    });

    it('honours a different configured minimum length', () => {
      const strict = service(16);
      expect(strict.validateStrength('Short1!Pass9').some((e) => /at least 16/.test(e))).toBe(true);
    });
  });

  describe('hash/verify', () => {
    const svc = service();

    it('produces an argon2id hash that verifies against the original', async () => {
      const hash = await svc.hash('Str0ng&Passw0rd!');
      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(await svc.verify(hash, 'Str0ng&Passw0rd!')).toBe(true);
    });

    it('rejects a wrong password', async () => {
      const hash = await svc.hash('Str0ng&Passw0rd!');
      expect(await svc.verify(hash, 'wrong-password')).toBe(false);
    });

    it('returns false (never throws) for a malformed hash', async () => {
      expect(await svc.verify('not-a-hash', 'anything')).toBe(false);
    });
  });
});
