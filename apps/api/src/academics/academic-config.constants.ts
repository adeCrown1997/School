/**
 * Academic-configuration constants, deliberately free of imports.
 *
 * These live apart from AcademicConfigService so that non-Nest callers — the
 * Prisma seed above all — can reach them without importing a decorated
 * provider, which would drag `@nestjs/common` (and its reflect-metadata
 * requirement) into a plain ts-node script. The alternative was repeating the
 * config key as a literal in the seed, where it would quietly drift from the
 * service that reads it.
 */

/** SystemConfig key holding min/max registrable units. Enforced at registration
 *  commit (INV-8); stored as data because it is policy, not code. */
export const CREDIT_POLICY_KEY = 'academic.credit_policy';

export interface CreditPolicy {
  minUnits: number;
  maxUnits: number;
}

/** Fallback used when no policy row exists yet, so registration has a defined
 *  rule on a fresh install rather than silently allowing anything. */
export const DEFAULT_CREDIT_POLICY: CreditPolicy = { minUnits: 15, maxUnits: 24 };
