import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import {
  DEFAULT_REGISTRATION_POLICY,
  REGISTRATION_POLICY_KEY,
  RegistrationPolicy,
} from './registration.constants';

/**
 * Reads and writes the registration policy (docs/03 §9.2/§9.3 open questions).
 *
 * A service of its own rather than a helper inside the course-list builder,
 * because three call sites need the same answer — the course list decides what
 * to show, submission decides what to accept, and the admin screen edits it —
 * and each would otherwise repeat the same defence against a hand-edited JSON
 * row. SystemConfig.value is `Json`, so a malformed row is always possible;
 * every field is validated individually and falls back on its own, so one bad
 * key does not discard a correct one beside it.
 */
@Injectable()
export class RegistrationPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<RegistrationPolicy & { isDefault: boolean }> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: REGISTRATION_POLICY_KEY },
    });
    if (!row) return { ...DEFAULT_REGISTRATION_POLICY, isDefault: true };
    return { ...this.normalise(row.value), isDefault: false };
  }

  /**
   * The effective policy without the `isDefault` marker, which is presentation
   * only and must never reach the stored row or the audit trail.
   */
  private async effective(): Promise<RegistrationPolicy> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: REGISTRATION_POLICY_KEY },
    });
    return row ? this.normalise(row.value) : { ...DEFAULT_REGISTRATION_POLICY };
  }

  private normalise(raw: unknown): RegistrationPolicy {
    const v = (raw ?? {}) as Partial<Record<keyof RegistrationPolicy, unknown>>;
    const d = DEFAULT_REGISTRATION_POLICY;
    return {
      prerequisiteEnforcement: this.enumOr(v.prerequisiteEnforcement, d.prerequisiteEnforcement),
      levelSpread:
        typeof v.levelSpread === 'number' && Number.isInteger(v.levelSpread) && v.levelSpread >= 0
          ? v.levelSpread
          : d.levelSpread,
      allowRepeatForUpgrade:
        typeof v.allowRepeatForUpgrade === 'boolean'
          ? v.allowRepeatForUpgrade
          : d.allowRepeatForUpgrade,
      enforceCapacity:
        typeof v.enforceCapacity === 'boolean' ? v.enforceCapacity : d.enforceCapacity,
      timetableClash: this.enumOr(v.timetableClash, d.timetableClash),
    };
  }

  /**
   * Replace the policy. A partial update is accepted and merged over the current
   * effective values, so an admin screen that only exposes one switch cannot
   * silently reset the others to their defaults.
   */
  async set(patch: Partial<RegistrationPolicy>, actor: AuthPrincipal) {
    const before = await this.effective();

    if (patch.levelSpread !== undefined) {
      if (!Number.isInteger(patch.levelSpread) || patch.levelSpread < 0 || patch.levelSpread > 3) {
        throw new BadRequestException(
          'levelSpread must be a whole number between 0 and 3 — a wider spread than three ' +
            'levels means the curriculum sequence is not being enforced at all',
        );
      }
    }

    const value: RegistrationPolicy = { ...before, ...this.definedOnly(patch) };
    await this.prisma.systemConfig.upsert({
      where: { key: REGISTRATION_POLICY_KEY },
      create: {
        key: REGISTRATION_POLICY_KEY,
        value: { ...value },
        description:
          'Registration rules: prerequisites, level spread, repeats, capacity (docs/03 §9)',
        updatedById: actor.userId,
      },
      update: { value: { ...value }, updatedById: actor.userId },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'registration.policy.set',
      entityType: 'SystemConfig',
      entityId: REGISTRATION_POLICY_KEY,
      before: { ...before },
      after: { ...value },
    });
    return { ...value, isDefault: false };
  }

  private enumOr<T extends string>(candidate: unknown, fallback: T): T {
    return candidate === 'BLOCK' || candidate === 'WARN' ? (candidate as T) : fallback;
  }

  /** Drops undefined keys so a spread cannot overwrite a value with `undefined`. */
  private definedOnly(patch: Partial<RegistrationPolicy>): Partial<RegistrationPolicy> {
    return Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<RegistrationPolicy>;
  }
}
