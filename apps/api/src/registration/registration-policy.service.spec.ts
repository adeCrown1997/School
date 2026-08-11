import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { RegistrationPolicyService } from './registration-policy.service';
import { DEFAULT_REGISTRATION_POLICY, REGISTRATION_POLICY_KEY } from './registration.constants';

/**
 * The policy row is `Json`, which means a hand-edited or half-migrated value is
 * always possible. What is proven here is that such a row cannot make the system
 * incoherent: every field is validated on its own and falls back on its own, a
 * partial write merges rather than resetting its neighbours, and the one bound
 * that could quietly disable the curriculum sequence — levelSpread — is refused
 * loudly rather than clamped silently.
 */
const actor: AuthPrincipal = {
  userId: 'u-registry',
  userType: 'STAFF',
  email: 'registry@uni.example',
  fullName: 'Registry',
  permissions: ['registration.policy.manage'],
  scopedPermissions: [],
  mustChangePassword: false,
};

function build(row: { value: unknown } | null = null) {
  const prisma = {
    systemConfig: {
      findUnique: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  return { service: new RegistrationPolicyService(prisma, audit), prisma, audit };
}

const stored = (over: Record<string, unknown> = {}) => ({
  value: {
    prerequisiteEnforcement: 'WARN',
    levelSpread: 2,
    allowRepeatForUpgrade: true,
    enforceCapacity: false,
    timetableClash: 'BLOCK',
    ...over,
  },
});

describe('RegistrationPolicyService.get', () => {
  it('answers with the shipped defaults when nothing is configured, and says so', async () => {
    const { service } = build(null);
    await expect(service.get()).resolves.toEqual({
      ...DEFAULT_REGISTRATION_POLICY,
      isDefault: true,
    });
  });

  it('reads the configured row and marks it as no longer the default', async () => {
    const { service } = build(stored());
    await expect(service.get()).resolves.toEqual({
      prerequisiteEnforcement: 'WARN',
      levelSpread: 2,
      allowRepeatForUpgrade: true,
      enforceCapacity: false,
      timetableClash: 'BLOCK',
      isDefault: false,
    });
  });

  it('looks the row up by its own key', async () => {
    const { service, prisma } = build(stored());
    await service.get();
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({
      where: { key: REGISTRATION_POLICY_KEY },
    });
  });

  /**
   * The point of per-field validation: a row written by hand, or by an older
   * migration that did not know a key yet, must not cost the institution the
   * settings that ARE valid beside it.
   */
  it('falls back per field, so one bad key does not discard a good neighbour', async () => {
    const { service } = build(stored({ levelSpread: 'two', prerequisiteEnforcement: 'MAYBE' }));
    await expect(service.get()).resolves.toMatchObject({
      levelSpread: DEFAULT_REGISTRATION_POLICY.levelSpread,
      prerequisiteEnforcement: DEFAULT_REGISTRATION_POLICY.prerequisiteEnforcement,
      allowRepeatForUpgrade: true,
      enforceCapacity: false,
      timetableClash: 'BLOCK',
    });
  });

  it('accepts only BLOCK or WARN for the two enforcement modes', async () => {
    const { service } = build(stored({ prerequisiteEnforcement: 'IGNORE', timetableClash: null }));
    const policy = await service.get();
    expect(policy.prerequisiteEnforcement).toBe(
      DEFAULT_REGISTRATION_POLICY.prerequisiteEnforcement,
    );
    expect(policy.timetableClash).toBe(DEFAULT_REGISTRATION_POLICY.timetableClash);
  });

  it('accepts zero as a level spread — pinning students to their own level is a real policy', async () => {
    const { service } = build(stored({ levelSpread: 0 }));
    await expect(service.get()).resolves.toMatchObject({ levelSpread: 0 });
  });

  it.each([-1, 1.5, Number.NaN, '2', null])(
    'refuses %p as a level spread and uses the default instead',
    async (bad) => {
      const { service } = build(stored({ levelSpread: bad }));
      await expect(service.get()).resolves.toMatchObject({
        levelSpread: DEFAULT_REGISTRATION_POLICY.levelSpread,
      });
    },
  );

  it('takes booleans only, never a truthy string', async () => {
    const { service } = build(stored({ enforceCapacity: 'false', allowRepeatForUpgrade: 1 }));
    await expect(service.get()).resolves.toMatchObject({
      enforceCapacity: DEFAULT_REGISTRATION_POLICY.enforceCapacity,
      allowRepeatForUpgrade: DEFAULT_REGISTRATION_POLICY.allowRepeatForUpgrade,
    });
  });

  it('survives a row whose value is null or empty — every field defaults, but the row exists', async () => {
    for (const value of [null, {}]) {
      const { service } = build({ value });
      await expect(service.get()).resolves.toEqual({
        ...DEFAULT_REGISTRATION_POLICY,
        isDefault: false,
      });
    }
  });

  it('never leaks an unknown key from the row into the effective policy', async () => {
    const { service } = build(stored({ someRemovedFlag: true }));
    expect(Object.keys(await service.get()).sort()).toEqual(
      [...Object.keys(DEFAULT_REGISTRATION_POLICY), 'isDefault'].sort(),
    );
  });
});

describe('RegistrationPolicyService.set', () => {
  /**
   * The merge is the whole reason `set` takes a patch: an admin screen that
   * exposes one switch must not reset the four settings it does not show.
   */
  it('merges a partial patch over the CURRENT values, not over the defaults', async () => {
    const { service, prisma } = build(stored());
    await service.set({ levelSpread: 3 }, actor);
    expect((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].update.value).toEqual({
      prerequisiteEnforcement: 'WARN',
      levelSpread: 3,
      allowRepeatForUpgrade: true,
      enforceCapacity: false,
      timetableClash: 'BLOCK',
    });
  });

  it('merges over the defaults when nothing was configured yet', async () => {
    const { service, prisma } = build(null);
    await service.set({ enforceCapacity: false }, actor);
    expect((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].create.value).toEqual({
      ...DEFAULT_REGISTRATION_POLICY,
      enforceCapacity: false,
    });
  });

  it('drops undefined keys, so spreading a partial object cannot blank a setting', async () => {
    const { service, prisma } = build(stored());
    await service.set(
      { levelSpread: undefined, timetableClash: undefined, enforceCapacity: true },
      actor,
    );
    expect((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].update.value).toMatchObject({
      levelSpread: 2,
      timetableClash: 'BLOCK',
      enforceCapacity: true,
    });
  });

  it('writes both branches of the upsert against the policy key, stamped with the actor', async () => {
    const { service, prisma } = build(null);
    await service.set({ levelSpread: 1 }, actor);
    const call = (prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual({ key: REGISTRATION_POLICY_KEY });
    expect(call.create).toMatchObject({ key: REGISTRATION_POLICY_KEY, updatedById: 'u-registry' });
    expect(call.update).toMatchObject({ updatedById: 'u-registry' });
  });

  it('returns the effective policy, which is no longer a default once written', async () => {
    const { service } = build(stored());
    await expect(service.set({ prerequisiteEnforcement: 'BLOCK' }, actor)).resolves.toEqual({
      prerequisiteEnforcement: 'BLOCK',
      levelSpread: 2,
      allowRepeatForUpgrade: true,
      enforceCapacity: false,
      timetableClash: 'BLOCK',
      isDefault: false,
    });
  });

  /**
   * A spread wider than three level bands lets a 100-level student register
   * 400-level courses, which is not a loosened rule but an absent one. It is
   * refused rather than clamped, so the admin learns their input was rejected.
   */
  it.each([4, -1, 2.5])('refuses %p as a level spread rather than clamping it', async (bad) => {
    const { service, prisma, audit } = build(stored());
    await expect(service.set({ levelSpread: bad }, actor)).rejects.toThrow(BadRequestException);
    await expect(service.set({ levelSpread: bad }, actor)).rejects.toThrow(
      /whole number between 0 and 3/,
    );
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('explains WHY the bound exists, so the refusal is actionable', async () => {
    const { service } = build(null);
    await expect(service.set({ levelSpread: 9 }, actor)).rejects.toThrow(
      /curriculum sequence is not being enforced at all/,
    );
  });

  it('accepts the boundary values 0 and 3', async () => {
    for (const spread of [0, 3]) {
      const { service } = build(stored());
      await expect(service.set({ levelSpread: spread }, actor)).resolves.toMatchObject({
        levelSpread: spread,
      });
    }
  });

  it('accepts an empty patch as a no-op write that materialises the current values', async () => {
    const { service, prisma } = build(null);
    await service.set({}, actor);
    expect((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].create.value).toEqual({
      ...DEFAULT_REGISTRATION_POLICY,
    });
  });

  /** Policy changes alter what every student may register, so they are auditable. */
  it('audits the change with the before and after states', async () => {
    const { service, audit } = build(stored());
    await service.set({ levelSpread: 1 }, actor);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'u-registry',
        actorLabel: 'registry@uni.example',
        action: 'registration.policy.set',
        entityType: 'SystemConfig',
        entityId: REGISTRATION_POLICY_KEY,
        before: expect.objectContaining({ levelSpread: 2 }),
        after: expect.objectContaining({ levelSpread: 1 }),
      }),
    );
  });

  it('records the defaults as the "before" state on the very first write', async () => {
    const { service, audit } = build(null);
    await service.set({ levelSpread: 2 }, actor);
    const entry = (audit.record as jest.Mock).mock.calls[0][0];
    expect(entry.before).toEqual({ ...DEFAULT_REGISTRATION_POLICY });
    expect(entry.before.isDefault).toBeUndefined();
  });
});
