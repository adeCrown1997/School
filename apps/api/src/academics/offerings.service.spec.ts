import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { OfferingsService } from './offerings.service';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * Offerings are the definition side of registration, so the rules proven here
 * are the ones whose violation would strand a registered student:
 *   • capacity may never be cut below the seats already taken;
 *   • an offering never moves session or course, since that would silently
 *     re-point every registration line attached to it;
 *   • a semester must belong to the session it is offered in, and a session that
 *     has ended accepts nothing new;
 *   • only a DRAFT offering is deletable;
 *   • seatsTaken is never written here — registration owns that counter.
 */
function build(over: { prisma?: Record<string, unknown>; faculty?: string | null } = {}) {
  const prisma = {
    $transaction: jest.fn(async (arg: unknown) =>
      typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : arg,
    ),
    ...over.prisma,
  } as unknown as PrismaService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  const structure = {
    resolveDepartmentLocation: jest.fn(async (departmentId: string | null | undefined) => ({
      departmentId: departmentId ?? null,
      facultyId: departmentId ? (over.faculty ?? 'fac-sci') : null,
    })),
  } as unknown as StructureService;
  return { service: new OfferingsService(prisma, audit, structure), prisma, audit };
}

const globalActor: AuthPrincipal = {
  userId: 'u-registry',
  userType: 'STAFF',
  email: 'registry@uni.example',
  fullName: 'Registry',
  permissions: ['offerings.manage'],
  scopedPermissions: [{ permission: 'offerings.manage', scope: { scopeType: 'GLOBAL' } }],
  mustChangePassword: false,
};

/** An HOD confined to one department — the scope-narrowing case. */
const hod = (departmentId: string): AuthPrincipal => ({
  userId: 'u-hod',
  userType: 'STAFF',
  email: 'hod@uni.example',
  fullName: 'HOD',
  permissions: ['offerings.manage'],
  scopedPermissions: [
    { permission: 'offerings.manage', scope: { scopeType: 'DEPARTMENT', departmentId } },
  ],
  mustChangePassword: false,
});

const openSemester = {
  id: 'sem1',
  name: 'First Semester',
  sequence: 1,
  sessionId: 'ses1',
  session: { id: 'ses1', name: '2024/2025', state: 'OPEN' },
};

const offering = (over: Record<string, unknown> = {}) => ({
  id: 'off1',
  courseId: 'crs1',
  sessionId: 'ses1',
  semesterId: 'sem1',
  departmentId: 'dep-csc',
  capacity: 100,
  seatsTaken: 40,
  status: 'OPEN',
  course: { code: 'CSC101', departmentId: 'dep-csc' },
  ...over,
});

describe('OfferingsService.create', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    course: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'crs1', code: 'CSC101', isActive: true, departmentId: 'dep-csc' }),
    },
    semester: { findUnique: jest.fn().mockResolvedValue(openSemester) },
    courseOffering: {
      create: jest.fn().mockResolvedValue({
        id: 'off1',
        courseId: 'crs1',
        sessionId: 'ses1',
        semesterId: 'sem1',
        departmentId: 'dep-csc',
        capacity: 100,
        status: 'DRAFT',
      }),
    },
    ...over,
  });

  it('creates a draft offering for an active course', async () => {
    const { service } = build({ prisma: base() });
    const created = await service.create(
      { courseId: 'crs1', sessionId: 'ses1', semesterId: 'sem1', capacity: 100 },
      globalActor,
    );
    expect(created.status).toBe('DRAFT');
  });

  it('refuses to offer an inactive course', async () => {
    const { service } = build({
      prisma: base({
        course: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'crs1',
            code: 'CSC101',
            isActive: false,
            departmentId: 'dep-csc',
          }),
        },
      }),
    });
    await expect(
      service.create({ courseId: 'crs1', sessionId: 'ses1', semesterId: 'sem1' }, globalActor),
    ).rejects.toThrow(/inactive and cannot be offered/i);
  });

  it('refuses a semester that belongs to a different session', async () => {
    const { service } = build({
      prisma: base({
        semester: {
          findUnique: jest.fn().mockResolvedValue({
            ...openSemester,
            sessionId: 'ses-other',
            session: { id: 'ses-other', name: '2023/2024', state: 'OPEN' },
          }),
        },
      }),
    });
    await expect(
      service.create({ courseId: 'crs1', sessionId: 'ses1', semesterId: 'sem1' }, globalActor),
    ).rejects.toThrow(/belongs to 2023\/2024, not the session given/);
  });

  it.each(['CLOSED', 'ARCHIVED'])('refuses to add an offering to a %s session', async (state) => {
    const { service } = build({
      prisma: base({
        semester: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ ...openSemester, session: { ...openSemester.session, state } }),
        },
      }),
    });
    await expect(
      service.create({ courseId: 'crs1', sessionId: 'ses1', semesterId: 'sem1' }, globalActor),
    ).rejects.toThrow(ConflictException);
  });

  it('refuses to mount a course on another department timetable', async () => {
    const { service } = build({ prisma: base() });
    await expect(
      service.create({ courseId: 'crs1', sessionId: 'ses1', semesterId: 'sem1' }, hod('dep-mth')),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('OfferingsService.update', () => {
  const withExisting = (over: Record<string, unknown> = {}) =>
    build({
      prisma: {
        courseOffering: {
          findUnique: jest.fn().mockResolvedValue(offering(over)),
          update: jest.fn().mockResolvedValue(offering({ ...over, capacity: 120 })),
        },
      },
    });

  it('refuses to cut capacity below the seats already taken', async () => {
    const { service } = withExisting();
    await expect(service.update('off1', { capacity: 10 }, globalActor)).rejects.toThrow(
      /cannot be set below the 40 seat\(s\) already taken/,
    );
  });

  it('allows capacity equal to the seats taken', async () => {
    const { service } = withExisting();
    await expect(service.update('off1', { capacity: 40 }, globalActor)).resolves.toBeDefined();
  });

  it('allows clearing capacity to uncapped', async () => {
    const { service } = withExisting();
    await expect(service.update('off1', { capacity: null }, globalActor)).resolves.toBeDefined();
  });

  it('refuses to return a published offering to draft', async () => {
    const { service } = withExisting();
    await expect(service.update('off1', { status: 'DRAFT' }, globalActor)).rejects.toThrow(
      /cannot return to draft/i,
    );
  });

  it('allows reopening a closed offering, since add/drop windows get extended', async () => {
    const { service } = withExisting({ status: 'CLOSED' });
    await expect(service.update('off1', { status: 'OPEN' }, globalActor)).resolves.toBeDefined();
  });

  it('refuses to open an offering with zero capacity', async () => {
    const { service } = withExisting({ status: 'DRAFT', capacity: 0, seatsTaken: 0 });
    await expect(service.update('off1', { status: 'OPEN' }, globalActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('never writes seatsTaken', async () => {
    const { service, prisma } = withExisting();
    await service.update('off1', { capacity: 120, status: 'CLOSED' }, globalActor);
    const data = (prisma as unknown as { courseOffering: { update: jest.Mock } }).courseOffering
      .update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('seatsTaken');
  });

  it('checks scope on the destination department when reassigning teaching', async () => {
    const { service } = withExisting();
    await expect(
      service.update('off1', { departmentId: 'dep-mth' }, hod('dep-csc')),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('OfferingsService.remove', () => {
  it('deletes a draft offering', async () => {
    const { service } = build({
      prisma: {
        courseOffering: {
          findUnique: jest.fn().mockResolvedValue(offering({ status: 'DRAFT', seatsTaken: 0 })),
          delete: jest.fn(),
        },
      },
    });
    await expect(service.remove('off1', globalActor)).resolves.toEqual({ removed: true });
  });

  it('refuses to delete anything past draft', async () => {
    const { service } = build({
      prisma: {
        courseOffering: {
          findUnique: jest.fn().mockResolvedValue(offering({ status: 'OPEN' })),
          delete: jest.fn(),
        },
      },
    });
    await expect(service.remove('off1', globalActor)).rejects.toThrow(
      /Only a draft offering can be deleted/,
    );
  });

  it('refuses to delete a draft that somehow has registrations', async () => {
    const { service } = build({
      prisma: {
        courseOffering: {
          findUnique: jest.fn().mockResolvedValue(offering({ status: 'DRAFT', seatsTaken: 3 })),
          delete: jest.fn(),
        },
      },
    });
    await expect(service.remove('off1', globalActor)).rejects.toThrow(
      /has registrations and cannot be deleted/,
    );
  });
});

describe('OfferingsService.generateFromCurriculum', () => {
  const version = (over: Record<string, unknown> = {}) => ({
    id: 'cv1',
    status: 'PUBLISHED',
    programme: { id: 'prog1', code: 'CSC-BSC', departmentId: 'dep-csc' },
    requirements: [
      { courseId: 'c1', semesterSequence: 1, course: { id: 'c1', code: 'CSC101', isActive: true } },
      { courseId: 'c2', semesterSequence: 1, course: { id: 'c2', code: 'CSC103', isActive: true } },
      { courseId: 'c3', semesterSequence: 2, course: { id: 'c3', code: 'CSC102', isActive: true } },
      {
        courseId: 'c4',
        semesterSequence: 1,
        course: { id: 'c4', code: 'OLD101', isActive: false },
      },
    ],
    ...over,
  });

  const setup = (over: Record<string, unknown> = {}, existing: Array<{ courseId: string }> = []) =>
    build({
      prisma: {
        curriculumVersion: { findUnique: jest.fn().mockResolvedValue(version(over)) },
        semester: { findUnique: jest.fn().mockResolvedValue(openSemester) },
        courseOffering: {
          findMany: jest.fn().mockResolvedValue(existing),
          createMany: jest.fn(),
        },
      },
    });

  const input = { curriculumVersionId: 'cv1', sessionId: 'ses1', semesterId: 'sem1' };

  it('mounts only the courses due in that semester, skipping inactive ones', async () => {
    const { service } = setup();
    const result = await service.generateFromCurriculum(input, globalActor);
    expect(result).toMatchObject({ created: 2, alreadyPresent: 0, skippedInactive: ['OLD101'] });
  });

  it('is idempotent — existing offerings are reported, not duplicated', async () => {
    const { service, prisma } = setup({}, [{ courseId: 'c1' }]);
    const result = await service.generateFromCurriculum(input, globalActor);
    expect(result).toMatchObject({ created: 1, alreadyPresent: 1 });
    const created = (prisma as unknown as { courseOffering: { createMany: jest.Mock } })
      .courseOffering.createMany.mock.calls[0][0].data as Array<{ courseId: string }>;
    expect(created.map((c) => c.courseId)).toEqual(['c2']);
  });

  it.each(['DRAFT', 'ARCHIVED'])('refuses to generate from a %s curriculum', async (status) => {
    const { service } = setup({ status });
    await expect(service.generateFromCurriculum(input, globalActor)).rejects.toThrow(
      /Only a published curriculum can drive offerings/,
    );
  });

  it('refuses when the semester has no active courses in the curriculum', async () => {
    const { service } = setup({
      requirements: [
        { courseId: 'c3', semesterSequence: 2, course: { id: 'c3', code: 'X', isActive: true } },
      ],
    });
    await expect(service.generateFromCurriculum(input, globalActor)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuses a curriculum owned by another department', async () => {
    const { service } = setup();
    await expect(service.generateFromCurriculum(input, hod('dep-mth'))).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('OfferingsService derived availability', () => {
  const listWith = (rows: Array<Record<string, unknown>>) =>
    build({
      prisma: { courseOffering: { findMany: jest.fn().mockResolvedValue(rows) } },
    }).service.list({});

  it('derives seats remaining and fullness from capacity and seatsTaken', async () => {
    const [row] = await listWith([{ capacity: 100, seatsTaken: 40 }]);
    expect(row).toMatchObject({ seatsAvailable: 60, isFull: false });
  });

  it('reports full at capacity', async () => {
    const [row] = await listWith([{ capacity: 40, seatsTaken: 40 }]);
    expect(row).toMatchObject({ seatsAvailable: 0, isFull: true });
  });

  it('never reports negative seats if the counter somehow overruns', async () => {
    const [row] = await listWith([{ capacity: 40, seatsTaken: 45 }]);
    expect(row).toMatchObject({ seatsAvailable: 0, isFull: true });
  });

  it('treats null capacity as uncapped rather than full', async () => {
    const [row] = await listWith([{ capacity: null, seatsTaken: 500 }]);
    expect(row).toMatchObject({ seatsAvailable: null, isFull: false });
  });
});
