import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AcademicConfigService } from './academic-config.service';
import { DEFAULT_CREDIT_POLICY } from './academic-config.constants';
import { AuthPrincipal } from '../common/auth-principal';
import { GradeBandDto } from './dto/academics.dto';

/**
 * Grading is DATA, so the coherence a hardcoded enum would give for free has to
 * be enforced here. The properties proven below are the ones that fail silently
 * if unchecked — a gap or an overlap in the bands does not surface until a
 * script cannot be graded, long after the scale was saved.
 *
 * The credit-policy tests cover the other silent-failure mode: SystemConfig
 * holds arbitrary JSON, so a hand-edited row must degrade to the documented
 * default rather than crash registration.
 */
function build(over: { prisma?: Record<string, unknown> } = {}) {
  const prisma = {
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
    ...over.prisma,
  } as unknown as PrismaService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  return { service: new AcademicConfigService(prisma, audit), prisma, audit };
}

const actor: AuthPrincipal = {
  userId: 'u-admin',
  userType: 'STAFF',
  email: 'admin@uni.example',
  fullName: 'Admin',
  permissions: ['academic_config.manage'],
  scopedPermissions: [{ permission: 'academic_config.manage', scope: { scopeType: 'GLOBAL' } }],
};

/** The seeded 5-point scale — the reference a valid band set must look like. */
const VALID_BANDS: GradeBandDto[] = [
  { grade: 'A', minScore: 70, maxScore: 100, gradePoint: 5 },
  { grade: 'B', minScore: 60, maxScore: 69, gradePoint: 4 },
  { grade: 'C', minScore: 50, maxScore: 59, gradePoint: 3 },
  { grade: 'D', minScore: 45, maxScore: 49, gradePoint: 2 },
  { grade: 'E', minScore: 40, maxScore: 44, gradePoint: 1 },
  { grade: 'F', minScore: 0, maxScore: 39, gradePoint: 0 },
];

/** Exercise validateBands through the public API that reaches it first. */
function createWith(bands: GradeBandDto[]) {
  const { service } = build({
    prisma: {
      gradeScale: {
        create: jest.fn().mockResolvedValue({ id: 'gs1', key: 'K', name: 'N', isDefault: true }),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue({ id: 'gs1', key: 'K', bands: [] }),
      },
      gradeBand: { createMany: jest.fn() },
    },
  });
  return service.createScale({ key: 'K', name: 'N', bands }, actor);
}

describe('AcademicConfigService grade-band validation', () => {
  it('accepts a contiguous scale covering 0-100', async () => {
    await expect(createWith(VALID_BANDS)).resolves.toBeDefined();
  });

  it('rejects an empty band set', async () => {
    await expect(createWith([])).rejects.toThrow(BadRequestException);
  });

  it('rejects overlapping bands', async () => {
    const bands = VALID_BANDS.map((b) => (b.grade === 'B' ? { ...b, maxScore: 75 } : b));
    await expect(createWith(bands)).rejects.toThrow(/overlap/i);
  });

  it('rejects a gap between bands, which would leave a score ungradeable', async () => {
    // C ends at 58 while D ends at 49: 59 maps to no grade at all.
    const bands = VALID_BANDS.map((b) => (b.grade === 'C' ? { ...b, minScore: 51 } : b));
    await expect(createWith(bands)).rejects.toThrow(/Gap between/i);
  });

  it('rejects a scale that does not start at 0', async () => {
    const bands = VALID_BANDS.map((b) => (b.grade === 'F' ? { ...b, minScore: 10 } : b));
    await expect(createWith(bands)).rejects.toThrow(/must start at 0/i);
  });

  it('rejects a scale that does not reach 100', async () => {
    const bands = VALID_BANDS.map((b) => (b.grade === 'A' ? { ...b, maxScore: 95 } : b));
    await expect(createWith(bands)).rejects.toThrow(/must reach 100/i);
  });

  it('rejects duplicate grade letters', async () => {
    const bands = VALID_BANDS.map((b) => (b.grade === 'B' ? { ...b, grade: 'A' } : b));
    await expect(createWith(bands)).rejects.toThrow(/Duplicate grade/i);
  });

  it('rejects a band whose minimum is above its maximum', async () => {
    const bands = VALID_BANDS.map((b) => (b.grade === 'C' ? { ...b, minScore: 59, maxScore: 50 } : b));
    await expect(createWith(bands)).rejects.toThrow(/is above its maximum/i);
  });

  it('rejects a higher band worth fewer grade points', async () => {
    // A outscores B but would carry 3 points to B's 4 — almost always a typo.
    const bands = VALID_BANDS.map((b) => (b.grade === 'A' ? { ...b, gradePoint: 3 } : b));
    await expect(createWith(bands)).rejects.toThrow(/fewer grade points/i);
  });

  it('normalises grade letters to upper case', async () => {
    const { service, prisma } = build({
      prisma: {
        gradeScale: {
          create: jest.fn().mockResolvedValue({ id: 'gs1', key: 'K', name: 'N', isDefault: true }),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({ id: 'gs1', key: 'K', bands: [] }),
        },
        gradeBand: { createMany: jest.fn() },
      },
    });
    await service.createScale(
      { key: 'k', name: 'N', bands: VALID_BANDS.map((b) => ({ ...b, grade: b.grade.toLowerCase() })) },
      actor,
    );
    const written = (prisma as unknown as { gradeBand: { createMany: jest.Mock } }).gradeBand
      .createMany.mock.calls[0][0].data as Array<{ grade: string }>;
    expect(written.map((b) => b.grade).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });
});

describe('AcademicConfigService.replaceBands (supersede, do not overwrite)', () => {
  it('refuses to edit bands once the scale has graded something', async () => {
    const { service } = build({
      prisma: {
        gradeScale: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'gs1', key: 'FIVE_POINT', bands: [], _count: { gradeRecords: 42 } }),
        },
      },
    });
    await expect(service.replaceBands('gs1', { bands: VALID_BANDS }, actor)).rejects.toThrow(
      ConflictException,
    );
  });

  it('allows editing while the scale has graded nothing', async () => {
    const { service } = build({
      prisma: {
        gradeScale: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'gs1', key: 'K', bands: [], _count: { gradeRecords: 0 } }),
        },
        gradeBand: { deleteMany: jest.fn(), createMany: jest.fn() },
      },
    });
    await expect(service.replaceBands('gs1', { bands: VALID_BANDS }, actor)).resolves.toBeDefined();
  });
});

describe('AcademicConfigService.setDefaultScale', () => {
  it('refuses to make a scale with no bands the default', async () => {
    const { service } = build({
      prisma: {
        gradeScale: {
          findUnique: jest.fn().mockResolvedValue({ id: 'gs1', isActive: true, isDefault: false, bands: [] }),
        },
      },
    });
    await expect(service.setDefaultScale('gs1', actor)).rejects.toThrow(BadRequestException);
  });

  it('refuses to make an inactive scale the default', async () => {
    const { service } = build({
      prisma: {
        gradeScale: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'gs1', isActive: false, isDefault: false, bands: [{ id: 'b1' }] }),
        },
      },
    });
    await expect(service.setDefaultScale('gs1', actor)).rejects.toThrow(ConflictException);
  });

  it('clears the previous default in the same transaction', async () => {
    const { service, prisma } = build({
      prisma: {
        gradeScale: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'gs2', key: 'FOUR', isActive: true, isDefault: false, bands: [{ id: 'b1' }] }),
          updateMany: jest.fn(),
          update: jest.fn(),
        },
      },
    });
    await service.setDefaultScale('gs2', actor);
    // One $transaction call carrying both the clear and the set: two defaults at
    // once would make "the current scale" ambiguous while results are computed.
    const tx = (prisma as unknown as { $transaction: jest.Mock }).$transaction;
    expect(tx).toHaveBeenCalledTimes(1);
    expect(tx.mock.calls[0][0]).toHaveLength(2);
  });
});

describe('AcademicConfigService.updateCategory', () => {
  it('refuses to deactivate a category still in use', async () => {
    const { service } = build({
      prisma: {
        courseCategory: {
          findUnique: jest.fn().mockResolvedValue({ id: 'c1', key: 'CORE', _count: { courses: 12 } }),
          update: jest.fn(),
        },
      },
    });
    await expect(service.updateCategory('c1', { isActive: false }, actor)).rejects.toThrow(
      /12 course\(s\) still use CORE/,
    );
  });

  it('allows deactivating an unused category', async () => {
    const { service } = build({
      prisma: {
        courseCategory: {
          findUnique: jest.fn().mockResolvedValue({ id: 'c1', key: 'SIWES', _count: { courses: 0 } }),
          update: jest.fn().mockResolvedValue({ id: 'c1', label: 'x', sortOrder: 0, isActive: false }),
        },
      },
    });
    await expect(service.updateCategory('c1', { isActive: false }, actor)).resolves.toBeDefined();
  });
});

describe('AcademicConfigService credit policy', () => {
  const withConfigValue = (value: unknown) =>
    build({
      prisma: {
        systemConfig: {
          findUnique: jest.fn().mockResolvedValue(value === undefined ? null : { value }),
          upsert: jest.fn(),
        },
      },
    }).service;

  it('falls back to the documented default when no row exists', async () => {
    await expect(withConfigValue(undefined).getCreditPolicy()).resolves.toEqual({
      ...DEFAULT_CREDIT_POLICY,
      isDefault: true,
    });
  });

  it('falls back when the stored JSON has the wrong shape', async () => {
    // A hand-edited config row must not take registration down with it.
    await expect(withConfigValue({ minUnits: 'fifteen' }).getCreditPolicy()).resolves.toEqual({
      ...DEFAULT_CREDIT_POLICY,
      isDefault: true,
    });
  });

  it('falls back when the stored minimum exceeds the maximum', async () => {
    await expect(withConfigValue({ minUnits: 30, maxUnits: 24 }).getCreditPolicy()).resolves.toEqual({
      ...DEFAULT_CREDIT_POLICY,
      isDefault: true,
    });
  });

  it('returns a well-formed stored policy as configured', async () => {
    await expect(withConfigValue({ minUnits: 12, maxUnits: 30 }).getCreditPolicy()).resolves.toEqual({
      minUnits: 12,
      maxUnits: 30,
      isDefault: false,
    });
  });

  it('refuses to save a minimum above the maximum', async () => {
    await expect(
      withConfigValue(undefined).setCreditPolicy({ minUnits: 30, maxUnits: 24 }, actor),
    ).rejects.toThrow(BadRequestException);
  });
});
