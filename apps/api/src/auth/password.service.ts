import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

/**
 * Password hashing + strength policy. Uses argon2id (memory-hard) with sensible
 * parameters. Strength rules are enforced here (business layer) in addition to
 * DTO validation, so no code path can persist a weak password.
 */
@Injectable()
export class PasswordService {
  private readonly minLength: number;

  constructor(private readonly config: ConfigService) {
    this.minLength = this.config.get<number>('PASSWORD_MIN_LENGTH', 12);
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 19456, // ~19 MiB
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Returns a list of policy violations (empty = acceptable). Requires length,
   * plus a mix of character classes, and rejects a few trivially-guessable
   * patterns. Kept explicit rather than a single regex for clear messaging.
   */
  validateStrength(password: string): string[] {
    const errors: string[] = [];
    if (password.length < this.minLength) {
      errors.push(`Password must be at least ${this.minLength} characters long`);
    }
    if (!/[a-z]/.test(password)) errors.push('Password must include a lowercase letter');
    if (!/[A-Z]/.test(password)) errors.push('Password must include an uppercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must include a digit');
    if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must include a symbol');
    if (/^(.)\1+$/.test(password)) errors.push('Password must not be a single repeated character');
    if (/^(password|123456|qwerty|admin)/i.test(password)) {
      errors.push('Password is too common');
    }
    return errors;
  }
}
