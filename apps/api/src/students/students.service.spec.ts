import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { IdGeneratorService } from './id-generator.service';
import { StudentsService, StudentMasterInput } from './students.service';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * StudentsService is where the university-owns-identity invariant is enforced at
 * the service layer (L3). These unit tests cover the pieces that are pure policy
 * and thus verifiable without a live database:
 *   • validateMasterInput — the cross-field rules shared by single-create AND
 *     bulk import (so import surfaces identical row errors);
 *   • assertMatricAvailable — the friendly duplicate pre-check (the DB unique
 *     index remains the authoritative guarantee);
 *   • applyProtectedAmendment — the sole protected-write path refuses anything
 *     that is not an amendable protected field, and refuses the immutable ids.
 */
function makeService(overrides: {
  prisma?: Partial<PrismaService>;
  structure?: Partial<StructureService>;
}): StudentsService {
  const prisma = {
    academicSession: { findUnique: jest.fn().mockResolvedValue({ id: 's1', name: '2024/2025' }) },
    studentStatus: {
      findUnique: jest.fn().mockResolvedValue({ id: 'active-id', key: 'ACTIVE' }),
    },
    ...overrides.prisma,
  } as unknown as PrismaService;

  const structure = {
    assertAcademicHierarchy: jest.fn().mockResolvedValue({ durationYears: 4 }),
    ...overrides.structure,
  } as unknown as StructureService;

  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  const idGen = { nextStudentId: jest.fn() } as unknown as IdGeneratorService;

  return new StudentsService(prisma, audit, structure, idGen);
}

function baseInput(over: Partial<StudentMasterInput> = {}): StudentMasterInput {
  return {
    matriculationNumber: 'CSC/2024/001',
    surname: 'Bello',
    firstName: 'Ada',
    dateOfBirth: new Date('2005-01-02'),
    facultyId: 'f1',
    departmentId: 'd1',
    programmeId: 'p1',
    admissionSessionId: 's1',
    currentLevel: 100,
    ...over,
  };
}

const actor: AuthPrincipal = {
  userId: 'admin1',
  userType: 'STAFF',
  email: 'registry@uni.example',
  fullName: 'Registry',
  permissions: [],
  scopedPermissions: [],
  mustChangePassword: false,
};

describe('StudentsService.validateMasterInput', () => {
  it('accepts a valid input and defaults the status to the seeded ACTIVE', async () => {
    const svc = makeService({});
    const out = await svc.validateMasterInput(baseInput());
    expect(out.studentStatusId).toBe('active-id');
  });

  it('normalizes the matriculation number before storing it', async () => {
    const svc = makeService({});
    const out = await svc.validateMasterInput(baseInput({ matriculationNumber: ' csc/2024/001 ' }));
    expect(out.matriculationNumber).toBe('CSC/2024/001');
  });

  it.each(['CSC/24/001', 'CSC-2024-001', '1SC/2024/001', 'CSC/2024/', 'not a matric'])(
    'rejects %s, which does not match PREFIX/YEAR/SEQUENCE',
    async (matriculationNumber) => {
      // Bulk import builds StudentMasterInput directly, bypassing the DTO, so the
      // format has to be enforced here too — not only by @Matches on the DTO.
      const svc = makeService({});
      await expect(svc.validateMasterInput(baseInput({ matriculationNumber }))).rejects.toThrow(
        /PREFIX\/YEAR\/SEQUENCE/,
      );
    },
  );

  it('rejects an invalid date of birth', async () => {
    const svc = makeService({});
    await expect(
      svc.validateMasterInput(baseInput({ dateOfBirth: new Date('not-a-date') })),
    ).rejects.toThrow(/Invalid date of birth/);
  });

  it('rejects a future date of birth', async () => {
    const svc = makeService({});
    const future = new Date(Date.now() + 86_400_000);
    await expect(svc.validateMasterInput(baseInput({ dateOfBirth: future }))).rejects.toThrow(
      /cannot be in the future/,
    );
  });

  it('rejects a level that is not a multiple of 100', async () => {
    const svc = makeService({});
    await expect(svc.validateMasterInput(baseInput({ currentLevel: 150 }))).rejects.toThrow(
      /multiple of 100/,
    );
  });

  it('rejects a level beyond the programme maximum (duration + 2 grace years)', async () => {
    // durationYears 4 → maxLevel (4+2)*100 = 600.
    const svc = makeService({});
    await expect(svc.validateMasterInput(baseInput({ currentLevel: 700 }))).rejects.toThrow(
      /exceeds the maximum/,
    );
  });

  it('rejects an unknown admission session', async () => {
    const svc = makeService({
      prisma: { academicSession: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
    });
    await expect(svc.validateMasterInput(baseInput())).rejects.toThrow(/Invalid admission session/);
  });

  it('rejects an explicit but unknown student status', async () => {
    const svc = makeService({
      prisma: {
        academicSession: {
          findUnique: jest.fn().mockResolvedValue({ id: 's1', name: '2024/2025' }),
        },
        studentStatus: { findUnique: jest.fn().mockResolvedValue(null) },
      } as never,
    });
    await expect(svc.validateMasterInput(baseInput({ studentStatusId: 'ghost' }))).rejects.toThrow(
      /Invalid student status/,
    );
  });
});

describe('StudentsService.assertMatricAvailable', () => {
  it('throws ConflictException when a matching matric already exists', async () => {
    const client = {
      studentRecord: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    } as unknown as PrismaService;
    const svc = makeService({});
    await expect(svc.assertMatricAvailable(client, 'CSC/2024/001')).rejects.toThrow(
      ConflictException,
    );
  });

  it('resolves when no record matches', async () => {
    const client = {
      studentRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const svc = makeService({});
    await expect(svc.assertMatricAvailable(client, 'CSC/2024/999')).resolves.toBeUndefined();
  });

  it('performs a case-insensitive lookup', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const client = { studentRecord: { findFirst } } as unknown as PrismaService;
    const svc = makeService({});
    await svc.assertMatricAvailable(client, 'Csc/2024/001');
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matriculationNumber: { equals: 'Csc/2024/001', mode: 'insensitive' } },
      }),
    );
  });
});

describe('StudentsService.listStatuses', () => {
  it('returns the configurable status vocabulary ordered for display', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'a', key: 'ACTIVE', label: 'Active', allowsLogin: true },
      { id: 'd', key: 'DEFERRED', label: 'Deferred', allowsLogin: false },
    ]);
    const svc = makeService({
      prisma: { studentStatus: { findMany } } as never,
    });
    const out = await svc.listStatuses();
    expect(out).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { label: 'asc' } }));
    // Never leaks anything beyond the reference fields the UI needs.
    expect(Object.keys(out[0])).toEqual(
      expect.arrayContaining(['id', 'key', 'label', 'allowsLogin']),
    );
  });
});

describe('StudentsService.applyProtectedAmendment (the sole protected-write path)', () => {
  const svc = makeService({});

  it('refuses an empty change set', async () => {
    await expect(svc.applyProtectedAmendment('rec1', {}, { action: 'x' }, actor)).rejects.toThrow(
      /No changes supplied/,
    );
  });

  it('refuses fields that are not protected/amendable', async () => {
    await expect(
      svc.applyProtectedAmendment('rec1', { photoKey: 'k' } as never, { action: 'x' }, actor),
    ).rejects.toThrow(/Not amendable via this path/);
  });

  it('refuses the immutable identifiers even though they are "protected"', async () => {
    await expect(
      svc.applyProtectedAmendment('rec1', { studentId: 'STU1' }, { action: 'x' }, actor),
    ).rejects.toThrow(/cannot be amended/);
    await expect(
      svc.applyProtectedAmendment('rec1', { matriculationNumber: 'NEW/1' }, { action: 'x' }, actor),
    ).rejects.toThrow(/cannot be amended/);
  });
});
