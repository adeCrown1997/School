import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { AcademicConfigService } from '../academics/academic-config.service';
import { CourseListResult, CourseListService } from './course-list.service';
import { EligibilityService } from './eligibility.service';
import { RegistrationPolicyService } from './registration-policy.service';
import { DEFAULT_REGISTRATION_POLICY, RegistrationPolicy } from './registration.constants';
import { RegistrationService } from './registration.service';

/**
 * The registration lifecycle (§9.4–§9.6).
 *
 * The invariant under test throughout is the SEAT LEDGER: a seat is held by an
 * ACTIVE line on a PENDING_APPROVAL, APPROVED or LOCKED registration and by
 * nothing else — so every transition across that boundary must claim or release
 * exactly once, and a DRAFT must claim nothing at all. The claims are raw SQL,
 * so the assertions are on the ARGUMENTS the transaction issued rather than on a
 * counter; the ORDER of those arguments is itself a rule, because ascending
 * offering id is the only thing stopping two overlapping submissions from
 * deadlocking.
 *
 * The rest is authority: who may edit, who may approve, and the several places
 * where the honest answer to a race is the winner's result rather than an error.
 */

/** Sorted so `localeCompare` order is visible in the assertions. */
const OFF_A = 'a0000000-0000-4000-8000-000000000001';
const OFF_B = 'b0000000-0000-4000-8000-000000000002';

const SESSION = { id: 'ses1', name: '2025/2026', isCurrent: true };
const SEMESTER = {
  id: 'sem1',
  sessionId: 'ses1',
  name: 'First Semester',
  sequence: 1,
  isCurrent: true,
};

const STUDENT = {
  id: 'stu1',
  matriculationNumber: 'CSC/2024/001',
  currentLevel: 200,
  facultyId: 'fac-sci',
  departmentId: 'dep-csc',
  programmeId: 'prog-csc',
};

/** An ACTIVE line as MUTATION_INCLUDE loads it. */
const line = (over: Record<string, unknown> = {}) => ({
  id: 'line-a',
  registrationId: 'reg1',
  courseOfferingId: OFF_A,
  creditUnits: 3,
  lineType: 'NEW',
  state: 'ACTIVE',
  exceptionId: null,
  addedAt: new Date('2026-01-06T10:00:00Z'),
  droppedAt: null,
  droppedById: null,
  courseOffering: {
    id: OFF_A,
    courseId: 'crs-a',
    capacity: 50,
    seatsTaken: 10,
    status: 'OPEN',
    course: { id: 'crs-a', code: 'CSC201', title: 'Data Structures', level: 200, creditUnits: 3 },
  },
  ...over,
});

const lineB = (over: Record<string, unknown> = {}) =>
  line({
    id: 'line-b',
    courseOfferingId: OFF_B,
    creditUnits: 2,
    courseOffering: {
      id: OFF_B,
      courseId: 'crs-b',
      capacity: null,
      seatsTaken: 4,
      status: 'OPEN',
      course: { id: 'crs-b', code: 'CSC203', title: 'Discrete Maths', level: 200, creditUnits: 2 },
    },
    ...over,
  });

const registration = (over: Record<string, unknown> = {}) => ({
  id: 'reg1',
  studentRecordId: 'stu1',
  sessionId: 'ses1',
  semesterId: 'sem1',
  status: 'DRAFT',
  level: 200,
  curriculumVersionId: 'cv1',
  totalUnits: 3,
  minUnits: null,
  maxUnits: null,
  submittedAt: null,
  approvedAt: null,
  lockedAt: null,
  lockedById: null,
  rejectReason: null,
  idempotencyKey: null,
  studentRecord: STUDENT,
  lines: [line()],
  approvals: [],
  ...over,
});

const ADVISER_STAGE = {
  id: 'stg-adviser',
  domain: 'REGISTRATION',
  sequence: 1,
  key: 'ADVISER',
  name: 'Academic Adviser',
  requiredRoleId: 'role-adviser',
  scopeKind: 'DEPARTMENT',
  isActive: true,
};
const HOD_STAGE = {
  ...ADVISER_STAGE,
  id: 'stg-hod',
  sequence: 2,
  key: 'HOD',
  name: 'Head of Department',
  requiredRoleId: 'role-hod',
};

const approval = (over: Record<string, unknown> = {}) => ({
  id: 'apr-1',
  registrationId: 'reg1',
  stageId: 'stg-adviser',
  decision: 'APPROVED',
  comment: null,
  decidedById: 'u-adviser',
  decidedAt: new Date('2026-01-08T10:00:00Z'),
  stage: { id: 'stg-adviser', key: 'ADVISER', sequence: 1 },
  ...over,
});

/** The off-list offering `validateOffListOffering` loads directly. */
const offering = (over: Record<string, unknown> = {}) => ({
  id: OFF_B,
  sessionId: 'ses1',
  semesterId: 'sem1',
  status: 'OPEN',
  course: { id: 'crs-b', code: 'CSC203', level: 200, creditUnits: 2, isActive: true },
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  offeringId: OFF_A,
  courseId: 'crs-a',
  code: 'CSC201',
  title: 'Data Structures',
  courseLevel: 200,
  creditUnits: 3,
  categoryKey: 'CORE',
  departmentId: 'dep-csc',
  lineType: 'NEW',
  requirementType: 'COMPULSORY',
  electiveGroup: null,
  preSelected: true,
  removable: true,
  alreadyRegistered: false,
  attempts: 0,
  lastGrade: null,
  prerequisites: { satisfied: true, unmet: [], enforcement: 'BLOCK' },
  capacity: { capacity: 50, seatsTaken: 10, seatsAvailable: 40, isFull: false },
  selectable: true,
  warnings: [],
  ...over,
});

const courseList = (over: Record<string, unknown> = {}) =>
  ({
    level: 200,
    semesterSequence: 1,
    curriculumVersion: { id: 'cv1', name: '2020 curriculum', status: 'PUBLISHED' },
    items: [item(), item({ offeringId: OFF_B, courseId: 'crs-b', code: 'CSC203', creditUnits: 2 })],
    excluded: [],
    electiveGroups: [],
    totals: { preSelectedUnits: 5, selectableUnits: 5, carryoverCount: 0, carryoverUnits: 0 },
    policy: { ...DEFAULT_REGISTRATION_POLICY },
    warnings: [],
    ...over,
  }) as unknown as CourseListResult;

/** What eligibility hands back — note the level and curriculum differ from the
 *  draft's snapshot, so a refresh at submission is visible. */
const REPORT = {
  eligible: true,
  gates: [],
  student: {
    id: 'stu1',
    matriculationNumber: 'CSC/2024/001',
    fullName: 'Balogun Ada',
    level: 300,
    curriculumVersionId: 'cv2',
  },
};

const principal = (over: Partial<AuthPrincipal> = {}): AuthPrincipal => ({
  userId: 'u-staff',
  userType: 'STAFF',
  email: 'adviser@uni.example',
  fullName: 'Course Adviser',
  permissions: [],
  scopedPermissions: [],
  mustChangePassword: false,
  ...over,
});

const owner = principal({
  userId: 'u-stu',
  userType: 'STUDENT',
  email: 'ada@student.uni.example',
  fullName: 'Balogun Ada',
  studentRecordId: 'stu1',
});

/** Staff holding one permission at the student's own department. */
const scoped = (permission: string, over: Partial<AuthPrincipal> = {}): AuthPrincipal =>
  principal({
    permissions: [permission],
    scopedPermissions: [
      { permission, scope: { scopeType: 'DEPARTMENT', departmentId: 'dep-csc' } },
    ],
    ...over,
  });

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

interface BuildOver {
  registration?: Record<string, unknown> | null;
  list?: CourseListResult;
  exceptions?: Array<Record<string, unknown>>;
  stages?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  offering?: Record<string, unknown> | null;
  creditPolicy?: { minUnits: number; maxUnits: number };
  policy?: Partial<RegistrationPolicy>;
  prerequisite?: { satisfied: boolean; unmet: Array<Record<string, unknown>> };
  /** The status the transaction re-reads — how a lost race is simulated. */
  freshStatus?: string;
  /** Every seat claim comes back empty, i.e. the course is full. */
  full?: boolean;
}

function build(over: BuildOver = {}) {
  const reg = over.registration === null ? null : (over.registration ?? registration());

  const tx = {
    registration: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ status: over.freshStatus ?? (reg?.status as string) ?? 'DRAFT' }),
      update: jest.fn().mockResolvedValue({}),
    },
    registrationLine: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { creditUnits: 5 } }),
    },
    registrationApproval: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $queryRaw: jest.fn().mockResolvedValue(over.full ? [] : [{ seats_taken: 11 }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };

  const prisma = {
    registration: {
      findUnique: jest.fn().mockResolvedValue(reg),
      // Every mutation returns `detail(id)`; the id proves which row it read.
      findUniqueOrThrow: jest.fn(async (args: { where: { id?: string } }) => ({
        id: args.where.id ?? 'reg1',
        loaded: true,
      })),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({
        id: 'reg-new',
        ...args.data,
      })),
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    registrationException: { findMany: jest.fn().mockResolvedValue(over.exceptions ?? []) },
    approvalStage: {
      findMany: jest.fn().mockResolvedValue(over.stages ?? [ADVISER_STAGE, HOD_STAGE]),
    },
    roleAssignment: {
      findMany: jest.fn().mockResolvedValue(
        over.assignments ?? [
          {
            scopeType: 'DEPARTMENT',
            facultyId: null,
            departmentId: 'dep-csc',
            programmeId: null,
          },
        ],
      ),
    },
    courseOffering: {
      findUnique: jest
        .fn()
        .mockResolvedValue(over.offering === undefined ? offering() : over.offering),
    },
    studentRecord: { findUnique: jest.fn().mockResolvedValue(STUDENT) },
    academicSession: {
      findUnique: jest.fn().mockResolvedValue(SESSION),
      findFirst: jest.fn().mockResolvedValue(SESSION),
    },
    semester: {
      findUnique: jest.fn().mockResolvedValue({ ...SEMESTER, session: SESSION }),
      findFirst: jest.fn().mockResolvedValue(SEMESTER),
    },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  const eligibility = {
    evaluate: jest.fn().mockResolvedValue(REPORT),
    assertCanRegister: jest.fn().mockResolvedValue(REPORT),
  } as unknown as EligibilityService;
  const courses = {
    build: jest.fn().mockResolvedValue(over.list ?? courseList()),
    prerequisiteStatus: jest
      .fn()
      .mockResolvedValue(over.prerequisite ?? { satisfied: true, unmet: [] }),
  } as unknown as CourseListService;
  const policyService = {
    get: jest.fn().mockResolvedValue({ ...DEFAULT_REGISTRATION_POLICY, ...over.policy }),
  } as unknown as RegistrationPolicyService;
  const academicConfig = {
    getCreditPolicy: jest
      .fn()
      .mockResolvedValue(over.creditPolicy ?? { minUnits: 3, maxUnits: 24 }),
  } as unknown as AcademicConfigService;

  const service = new RegistrationService(
    prisma,
    audit,
    eligibility,
    courses,
    policyService,
    academicConfig,
  );
  return { service, prisma, tx, audit, eligibility, courses, policyService, academicConfig };
}

/** The offering ids a transaction claimed, in the order it claimed them. */
const claimed = (tx: { $queryRaw: jest.Mock }): string[] =>
  tx.$queryRaw.mock.calls.map((c) => c[1] as string);
const released = (tx: { $executeRaw: jest.Mock }): string[] =>
  tx.$executeRaw.mock.calls.map((c) => c[1] as string);

describe('RegistrationService.resolvePeriod', () => {
  it('answers with the current session and its current semester when asked for neither', async () => {
    const { service, prisma } = build();
    const { session, semester } = await service.resolvePeriod();
    expect(session.id).toBe('ses1');
    expect(semester.id).toBe('sem1');
    expect((prisma.academicSession.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      isCurrent: true,
    });
  });

  /** Registering into the wrong semester is worse than being told the calendar
   *  is unset, so neither fallback silently picks the newest row. */
  it('refuses rather than guessing when no session is current', async () => {
    const { service, prisma } = build();
    (prisma.academicSession.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.resolvePeriod()).rejects.toThrow(/no academic session is marked current/i);
  });

  it('refuses when the session has no current semester, naming the session', async () => {
    const { service, prisma } = build();
    (prisma.semester.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.resolvePeriod()).rejects.toThrow(
      /no semester is marked current in 2025\/2026/i,
    );
  });

  it('takes the session from the semester when a semester is named', async () => {
    const { service, prisma } = build();
    const { session } = await service.resolvePeriod(null, 'sem1');
    expect(session.id).toBe('ses1');
    expect(prisma.academicSession.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a semester that belongs to a different session', async () => {
    const { service } = build();
    await expect(service.resolvePeriod('ses-other', 'sem1')).rejects.toThrow(
      /does not belong to the requested session/i,
    );
  });

  it('reports an unknown semester', async () => {
    const { service, prisma } = build();
    (prisma.semester.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.resolvePeriod(null, 'sem-ghost')).rejects.toThrow(NotFoundException);
  });
});

describe('self-service authority', () => {
  it('refuses a staff principal on the student routes', () => {
    const { service } = build();
    expect(() => service.ownRecordId(principal())).toThrow(/for students/i);
    expect(service.ownRecordId(owner)).toBe('stu1');
  });

  it('returns the caller’s own registration', async () => {
    const { service } = build();
    await expect(service.findOneForStudent('reg1', owner)).resolves.toMatchObject({ id: 'reg1' });
  });

  /** The same answer for "does not exist" and "is not yours": the alternative
   *  confirms to a stranger that a given id is a real registration. */
  it('answers NOT FOUND — not FORBIDDEN — for someone else’s registration', async () => {
    const { service } = build({ registration: registration({ studentRecordId: 'stu-other' }) });
    await expect(service.findOneForStudent('reg1', owner)).rejects.toThrow(NotFoundException);
  });
});

describe('RegistrationService.openDraft', () => {
  it('returns an existing registration without re-checking eligibility', async () => {
    const { service, prisma, eligibility } = build();
    await expect(service.openDraft('stu1', owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(eligibility.assertCanRegister).not.toHaveBeenCalled();
    expect(prisma.registration.create).not.toHaveBeenCalled();
  });

  /** INV-7: the level and curriculum version are snapshotted, and they come from
   *  the eligibility report rather than from the caller. */
  it('snapshots level and curriculum version on creation, and audits who opened it', async () => {
    const { service, prisma, audit } = build({ registration: null });
    await service.openDraft('stu1', owner);
    expect((prisma.registration.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      studentRecordId: 'stu1',
      sessionId: 'ses1',
      semesterId: 'sem1',
      level: 300,
      curriculumVersionId: 'cv2',
      status: 'DRAFT',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'registration.draft.open' }),
    );
  });

  it('gives the loser of a two-tab race the winner’s draft, not an error', async () => {
    const { service, prisma } = build({ registration: null });
    (prisma.registration.create as jest.Mock).mockRejectedValue(p2002());
    await expect(service.openDraft('stu1', owner)).resolves.toMatchObject({ id: 'reg1' });
  });

  it('propagates any other database failure', async () => {
    const { service, prisma } = build({ registration: null });
    (prisma.registration.create as jest.Mock).mockRejectedValue(new Error('connection lost'));
    await expect(service.openDraft('stu1', owner)).rejects.toThrow('connection lost');
  });
});

/**
 * Who may change a registration, and when. Exercised through addCourses because
 * add / drop / submit all route through the same assertActorMayEdit — one rule,
 * so a new mutation cannot accidentally get a laxer one.
 */
describe('mutation authority', () => {
  const add = (over: BuildOver, actor: AuthPrincipal, onBehalf = false) =>
    build(over).service.addCourses('reg1', [OFF_B], actor, { onBehalf });

  it('reports a registration that does not exist', async () => {
    await expect(add({ registration: null }, owner)).rejects.toThrow(NotFoundException);
  });

  it('refuses an empty course list', async () => {
    const { service } = build();
    await expect(service.addCourses('reg1', [], owner)).rejects.toThrow(
      /no courses were supplied/i,
    );
  });

  /** INV-9: a lock is undone by an amendment with its own trail, not by an edit —
   *  and that holds for the registry too, which is why the check precedes scope. */
  it('refuses every edit on a LOCKED registration, registry included', async () => {
    const reg = registration({ status: 'LOCKED' });
    await expect(add({ registration: reg }, owner)).rejects.toThrow(/locked/i);
    await expect(add({ registration: reg }, scoped('registration.manage'), true)).rejects.toThrow(
      /approved amendment from the registry/i,
    );
  });

  it('refuses an edit on a cancelled registration', async () => {
    await expect(
      add({ registration: registration({ status: 'CANCELLED' }) }, owner),
    ).rejects.toThrow(ConflictException);
  });

  it('tells a student with a pending registration to ask their adviser', async () => {
    await expect(
      add({ registration: registration({ status: 'PENDING_APPROVAL' }) }, owner),
    ).rejects.toThrow(/awaiting approval\. ask your course adviser/i);
  });

  it('refuses a student editing an approved registration', async () => {
    await expect(
      add({ registration: registration({ status: 'APPROVED' }) }, owner),
    ).rejects.toThrow(/approved and can no longer be changed by you/i);
  });

  it('refuses a student touching a registration that is not theirs', async () => {
    await expect(
      add({ registration: registration({ studentRecordId: 'stu-other' }) }, owner),
    ).rejects.toThrow(/does not belong to you/i);
  });

  /** Staff authority over a registration is authority over the STUDENT. */
  it('scope-checks staff acting on a student’s behalf', async () => {
    const outsider = principal({
      permissions: ['registration.manage'],
      scopedPermissions: [
        {
          permission: 'registration.manage',
          scope: { scopeType: 'DEPARTMENT', departmentId: 'dep-other' },
        },
      ],
    });
    await expect(add({}, outsider, true)).rejects.toThrow(/outside your assigned scope/i);
  });
});

describe('RegistrationService.addCourses', () => {
  it('adds a listed course with the list’s units and claims no seat on a draft', async () => {
    const { service, tx } = build();
    await service.addCourses('reg1', [OFF_B], owner);
    expect((tx.registrationLine.create as jest.Mock).mock.calls[0][0].data).toEqual({
      registrationId: 'reg1',
      courseOfferingId: OFF_B,
      creditUnits: 2,
      lineType: 'NEW',
      exceptionId: null,
    });
    // A DRAFT holds nothing, so registration day is not spent on abandoned carts.
    expect(claimed(tx)).toEqual([]);
  });

  it('recomputes the unit total inside the same transaction', async () => {
    const { service, tx } = build();
    await service.addCourses('reg1', [OFF_B], owner);
    expect((tx.registrationLine.aggregate as jest.Mock).mock.calls[0][0].where).toEqual({
      registrationId: 'reg1',
      state: 'ACTIVE',
    });
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data).toEqual({ totalUnits: 5 });
  });

  it('claims a seat when the registration is already holding seats', async () => {
    const { service, tx, audit } = build({
      registration: registration({ status: 'PENDING_APPROVAL' }),
    });
    await service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true });
    expect(claimed(tx)).toEqual([OFF_B]);
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'registration.line.add.on_behalf',
        metadata: expect.objectContaining({ courses: ['CSC203'], seatsClaimed: true }),
      }),
    );
  });

  /** A retried multi-course add must not fail halfway through. */
  it('skips an offering already on the registration instead of failing', async () => {
    const { service, prisma } = build();
    await expect(service.addCourses('reg1', [OFF_A], owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('deduplicates a repeated offering id in one request', async () => {
    const { service, tx } = build();
    await service.addCourses('reg1', [OFF_B, OFF_B], owner);
    expect(tx.registrationLine.create as jest.Mock).toHaveBeenCalledTimes(1);
  });

  it('refuses an unselectable item using the list’s own warning', async () => {
    const { service } = build({
      list: courseList({
        items: [
          item({
            offeringId: OFF_B,
            courseId: 'crs-b',
            code: 'CSC203',
            selectable: false,
            warnings: ['CSC203 is full (40 of 40 seats taken).'],
          }),
        ],
      }),
    });
    await expect(service.addCourses('reg1', [OFF_B], owner)).rejects.toThrow(/CSC203 is full/);
  });

  /** The exception is recorded ON THE LINE, so a later reader can see which
   *  approval let the course through rather than wondering how it got there. */
  it('attaches an approved prerequisite override to the line it excuses', async () => {
    const { service, tx } = build({
      list: courseList({
        items: [
          item({
            offeringId: OFF_B,
            courseId: 'crs-b',
            code: 'CSC203',
            prerequisites: { satisfied: false, unmet: [], enforcement: 'WARN' },
          }),
        ],
      }),
      exceptions: [
        {
          id: 'exc-1',
          exceptionType: 'PREREQUISITE_OVERRIDE',
          parameters: { courseId: 'crs-b' },
          reason: 'Head of department approved',
        },
      ],
    });
    await service.addCourses('reg1', [OFF_B], owner);
    expect((tx.registrationLine.create as jest.Mock).mock.calls[0][0].data.exceptionId).toBe(
      'exc-1',
    );
  });

  it('checks the unit ceiling on the way in, not only at submission', async () => {
    const { service } = build({ creditPolicy: { minUnits: 3, maxUnits: 4 } });
    await expect(service.addCourses('reg1', [OFF_B], owner)).rejects.toThrow(
      /would take you to 5 units, above the maximum of 4/i,
    );
  });

  it('claims seats in ascending offering id order', async () => {
    const { service, tx } = build({
      registration: registration({ status: 'PENDING_APPROVAL', lines: [] }),
    });
    await service.addCourses('reg1', [OFF_B, OFF_A], scoped('registration.manage'), {
      onBehalf: true,
    });
    expect(claimed(tx)).toEqual([OFF_A, OFF_B]);
  });

  it('translates the partial unique index into a plain answer', async () => {
    const { service, tx } = build();
    (tx.registrationLine.create as jest.Mock).mockRejectedValue(p2002());
    await expect(service.addCourses('reg1', [OFF_B], owner)).rejects.toThrow(
      /already on this registration/i,
    );
  });

  /**
   * The staff-only escape hatch. It exists because real registration includes
   * cases the curriculum does not describe — a substitute course, an elective
   * from another department, a transfer student out of sequence — but the checks
   * that protect the record itself still apply.
   */
  describe('off the §9.2 list', () => {
    const offList = (over: BuildOver = {}) =>
      build({
        list: courseList({
          items: [],
          excluded: [
            {
              courseId: 'crs-b',
              code: 'CSC203',
              title: 'Discrete Maths',
              reason: 'ALREADY_PASSED',
              message: 'You passed CSC203 in 2024/2025 with a B.',
            },
          ],
        }),
        ...over,
      });

    it('tells a student WHY the course is not on their list, in the list’s words', async () => {
      const { service } = offList();
      await expect(service.addCourses('reg1', [OFF_B], owner)).rejects.toThrow(
        /you passed CSC203 in 2024\/2025 with a B/i,
      );
    });

    it('lets staff add it, and records an already-passed course as a REPEAT', async () => {
      const { service, tx, courses } = offList();
      await service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true });
      expect((tx.registrationLine.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
        courseOfferingId: OFF_B,
        creditUnits: 2,
        lineType: 'REPEAT',
      });
      expect(courses.prerequisiteStatus).toHaveBeenCalledWith('stu1', 'crs-b');
    });

    it('reports an offering that does not exist', async () => {
      const { service } = offList({ offering: null });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses an offering from another session or semester', async () => {
      const { service } = offList({ offering: offering({ semesterId: 'sem2' }) });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(/offered in a different session or semester/i);
    });

    it('refuses an offering that is not open, naming its state', async () => {
      const { service } = offList({ offering: offering({ status: 'CLOSED' }) });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(/not open for registration \(offering is closed\)/i);
    });

    it('refuses a course retired from the catalogue', async () => {
      const { service } = offList({
        offering: offering({
          course: { id: 'crs-b', code: 'CSC203', level: 200, creditUnits: 2, isActive: false },
        }),
      });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(/retired from the catalogue/i);
    });

    /** Levels count in hundreds, so the default spread of 1 admits 300 to a
     *  200-level student and refuses 400 (see isLevelWithinSpread). */
    it('refuses a course beyond the configured level spread', async () => {
      const { service } = offList({
        offering: offering({
          course: { id: 'crs-b', code: 'CSC403', level: 400, creditUnits: 2, isActive: true },
        }),
      });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(/CSC403 is 400 level, more than 1 level\(s\) above a 200 level student/i);
    });

    it('refuses unmet prerequisites under BLOCK, quoting each one', async () => {
      const { service } = offList({
        prerequisite: {
          satisfied: false,
          unmet: [{ code: 'CSC101', message: 'You have not taken CSC101.' }],
        },
      });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(/unmet prerequisites: CSC101 — You have not taken CSC101/);
    });

    it('lets an approved override stand in for the prerequisite check', async () => {
      const { service, courses } = offList({
        prerequisite: { satisfied: false, unmet: [{ code: 'CSC101', message: 'not taken' }] },
        exceptions: [
          {
            id: 'exc-9',
            exceptionType: 'PREREQUISITE_OVERRIDE',
            parameters: { courseIds: ['crs-b'] },
            reason: 'Transfer student',
          },
        ],
      });
      await expect(
        service.addCourses('reg1', [OFF_B], scoped('registration.manage'), { onBehalf: true }),
      ).resolves.toMatchObject({ id: 'reg1' });
      expect(courses.prerequisiteStatus).not.toHaveBeenCalled();
    });
  });
});

describe('RegistrationService.dropLine', () => {
  /** A dropped course is part of the registration's history — hence DROPPED
   *  rather than deleted, which is also what lets the same offering be re-added. */
  it('marks the line dropped, records who dropped it, and keeps the row', async () => {
    const { service, tx } = build();
    await service.dropLine('reg1', 'line-a', owner, { reason: 'Timetable clash' });
    const data = (tx.registrationLine.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ state: 'DROPPED', droppedById: 'u-stu' });
    expect(data.droppedAt).toBeInstanceOf(Date);
    expect(released(tx)).toEqual([]);
  });

  it('records the stated reason on the audit line', async () => {
    const { service, tx, audit } = build();
    await service.dropLine('reg1', 'line-a', owner, { reason: 'Timetable clash' });
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'registration.line.drop',
        metadata: expect.objectContaining({
          course: 'CSC201',
          seatReleased: false,
          reason: 'Timetable clash',
          carryoverOverride: null,
        }),
      }),
    );
  });

  it('releases the seat when the registration was holding one', async () => {
    const { service, tx } = build({ registration: registration({ status: 'APPROVED' }) });
    await service.dropLine('reg1', 'line-a', scoped('registration.manage'), { onBehalf: true });
    expect(released(tx)).toEqual([OFF_A]);
  });

  it('reports a line that is not on this registration', async () => {
    const { service } = build();
    await expect(service.dropLine('reg1', 'line-ghost', owner)).rejects.toThrow(NotFoundException);
  });

  it('treats a second drop of the same line as done', async () => {
    const { service, prisma } = build({
      registration: registration({ lines: [line({ state: 'DROPPED' })] }),
    });
    await expect(service.dropLine('reg1', 'line-a', owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /** R5: a carryover must be retaken at the next opportunity, so dropping one is
   *  a documented exception rather than a student's choice. */
  describe('carryovers', () => {
    const carryover = registration({ lines: [line({ lineType: 'CARRYOVER' })] });

    it('refuses the student, and says where approval comes from', async () => {
      const { service } = build({ registration: carryover });
      await expect(service.dropLine('reg1', 'line-a', owner)).rejects.toThrow(
        /CSC201 is a carryover and must be retaken.*approval from the registry/is,
      );
    });

    it('refuses staff who cannot rule on exceptions either', async () => {
      const { service } = build({ registration: carryover });
      await expect(
        service.dropLine('reg1', 'line-a', scoped('registration.manage'), { onBehalf: true }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the drop when an approved CARRYOVER_REMOVAL covers the course', async () => {
      const { service, tx } = build({
        registration: carryover,
        exceptions: [
          {
            id: 'exc-c',
            exceptionType: 'CARRYOVER_REMOVAL',
            parameters: { courseId: 'crs-a' },
            reason: 'Course no longer offered',
          },
        ],
      });
      await service.dropLine('reg1', 'line-a', owner);
      expect((tx.registrationLine.update as jest.Mock).mock.calls[0][0].data.exceptionId).toBe(
        'exc-c',
      );
    });

    /** Until the exception workflow ships, the officer who would rule on the
     *  written request may act directly — and the audit line says so explicitly,
     *  so the decision is not invisible. */
    it('lets the exception reviewer act directly, and names the override in the audit', async () => {
      const reviewer = scoped('registration.manage', {
        permissions: ['registration.manage', 'registration.exception.review'],
      });
      const { service, audit, tx } = build({ registration: carryover });
      await service.dropLine('reg1', 'line-a', reviewer, { onBehalf: true });
      expect(audit.recordTx).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'registration.line.drop.on_behalf',
          metadata: expect.objectContaining({
            lineType: 'CARRYOVER',
            carryoverOverride: 'exercised_by_exception_reviewer',
          }),
        }),
      );
    });
  });
});

describe('RegistrationService.submit', () => {
  /** The response was lost and the student pressed the button again; the honest
   *  answer is the registration they already have. */
  it('treats a repeat submission as a success', async () => {
    const { service, prisma } = build({
      registration: registration({ status: 'PENDING_APPROVAL' }),
    });
    await expect(service.submit('reg1', owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to re-submit an approved registration, naming its state', async () => {
    const { service } = build({ registration: registration({ status: 'APPROVED' }) });
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      /this registration is approved and cannot be submitted again/i,
    );
  });

  it('refuses an empty registration', async () => {
    const { service } = build({ registration: registration({ lines: [] }) });
    await expect(service.submit('reg1', owner)).rejects.toThrow(/add at least one course/i);
  });

  /** Everything advisory becomes enforcing here, including the gates: a fee hold
   *  can land between opening a draft and submitting it. */
  it('re-asserts eligibility for this exact period', async () => {
    const { service, eligibility } = build();
    await service.submit('reg1', owner);
    expect(eligibility.assertCanRegister).toHaveBeenCalledWith('stu1', 'ses1', 'sem1');
  });

  it('refuses a registration above the unit ceiling', async () => {
    const { service } = build({ creditPolicy: { minUnits: 1, maxUnits: 2 } });
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      /registered 3 units, above the maximum of 2/i,
    );
  });

  it('refuses a registration below the floor, and points at the override', async () => {
    const { service } = build({ creditPolicy: { minUnits: 15, maxUnits: 24 } });
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      /below the minimum of 15.*approved unit override/is,
    );
  });

  /** The snapshot is what a submission WRITES; reading it back would let a stale
   *  draft carry last session's policy into this one. */
  it('reads fresh bounds rather than the draft’s snapshot', async () => {
    const { service, academicConfig } = build({
      registration: registration({ minUnits: 1, maxUnits: 99 }),
      creditPolicy: { minUnits: 15, maxUnits: 24 },
    });
    await expect(service.submit('reg1', owner)).rejects.toThrow(/below the minimum of 15/i);
    expect(academicConfig.getCreditPolicy).toHaveBeenCalled();
  });

  it('lets an approved unit override lower the floor, and records which one', async () => {
    const { service, tx, audit } = build({
      creditPolicy: { minUnits: 15, maxUnits: 24 },
      exceptions: [
        {
          id: 'exc-u',
          exceptionType: 'UNIT_OVERRIDE',
          parameters: { minUnits: 3 },
          reason: 'Final-year student with three units left',
        },
      ],
    });
    await service.submit('reg1', owner);
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data).toMatchObject({
      minUnits: 3,
      maxUnits: 24,
    });
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ after: expect.objectContaining({ unitOverrideId: 'exc-u' }) }),
    );
  });

  /** An override may only RELAX. One that tightened a bound would be a policy
   *  change wearing a student's name. */
  it('ignores an override that would tighten a bound', async () => {
    const { service, tx } = build({
      creditPolicy: { minUnits: 3, maxUnits: 24 },
      exceptions: [
        {
          id: 'exc-u',
          exceptionType: 'UNIT_OVERRIDE',
          parameters: { minUnits: 20, maxUnits: 2 },
          reason: 'Mistaken entry',
        },
      ],
    });
    await service.submit('reg1', owner);
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data).toMatchObject({
      minUnits: 3,
      maxUnits: 24,
    });
  });

  it('claims every active seat, in ascending offering id order', async () => {
    const { service, tx } = build({
      registration: registration({ lines: [lineB(), line()], totalUnits: 5 }),
    });
    await service.submit('reg1', owner);
    expect(claimed(tx)).toEqual([OFF_A, OFF_B]);
  });

  /** A resubmission after rejection is a NEW cycle: last cycle's signatures must
   *  not count towards it. They survive in the append-only audit log. */
  it('clears last cycle’s approvals when a rejected registration is resubmitted', async () => {
    const { service, tx } = build({
      registration: registration({
        status: 'REJECTED',
        rejectReason: 'Wrong elective',
        approvals: [approval({ decision: 'REJECTED', comment: 'Wrong elective' })],
      }),
    });
    await service.submit('reg1', owner);
    expect(tx.registrationApproval.deleteMany).toHaveBeenCalledWith({
      where: { registrationId: 'reg1' },
    });
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data.rejectReason).toBeNull();
  });

  /** INV-7/INV-8: submission is the authoritative moment, so a student promoted
   *  since opening the draft registers at their NEW level. */
  it('refreshes the level and curriculum snapshot from the eligibility report', async () => {
    const { service, tx } = build();
    await service.submit('reg1', owner, { idempotencyKey: 'key-1' });
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data).toMatchObject({
      status: 'PENDING_APPROVAL',
      totalUnits: 3,
      level: 300,
      curriculumVersionId: 'cv2',
      idempotencyKey: 'key-1',
    });
  });

  it('records the courses it submitted', async () => {
    const { service, tx, audit } = build();
    await service.submit('reg1', owner);
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'registration.submit',
        before: { status: 'DRAFT' },
        after: expect.objectContaining({ courses: ['CSC201'], totalUnits: 3 }),
      }),
    );
  });

  it('refuses the loser of a two-tab submit rather than claiming a second round of seats', async () => {
    const { service } = build({ freshStatus: 'PENDING_APPROVAL' });
    await expect(service.submit('reg1', owner)).rejects.toThrow(/already submitted a moment ago/i);
  });

  it('names the course that filled up while the student was choosing', async () => {
    const { service } = build({ full: true });
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      /CSC201 filled up while you were registering/i,
    );
  });

  it('returns what the winning attempt produced when the idempotency key raced', async () => {
    const { service, prisma } = build();
    (prisma.registration.findUnique as jest.Mock).mockImplementation(
      async (args: { where: { idempotencyKey?: string } }) =>
        args.where.idempotencyKey ? { id: 'reg-twin' } : registration(),
    );
    (prisma.$transaction as jest.Mock).mockRejectedValue(p2002());
    await expect(service.submit('reg1', owner, { idempotencyKey: 'key-1' })).resolves.toMatchObject(
      {
        id: 'reg-twin',
      },
    );
  });

  it('propagates a unique-constraint failure that was not the idempotency key', async () => {
    const { service, prisma } = build();
    (prisma.$transaction as jest.Mock).mockRejectedValue(p2002());
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  /** A result published overnight can turn a satisfied prerequisite into an unmet
   *  one. Better to say so now than to have an approver discover it — or not. */
  it('re-checks prerequisites at submission under BLOCK', async () => {
    const { service } = build({
      prerequisite: { satisfied: false, unmet: [{ code: 'CSC101', message: 'not passed' }] },
    });
    await expect(service.submit('reg1', owner)).rejects.toThrow(
      /prerequisites are no longer satisfied for CSC201 \(needs CSC101\)/i,
    );
  });

  it('skips the re-check for a line that already carries an exception', async () => {
    const { service, courses } = build({
      registration: registration({ lines: [line({ exceptionId: 'exc-1' })] }),
      prerequisite: { satisfied: false, unmet: [{ code: 'CSC101', message: 'not passed' }] },
    });
    await expect(service.submit('reg1', owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(courses.prerequisiteStatus).not.toHaveBeenCalled();
  });

  it('leaves the judgement to the approval chain when policy only WARNS', async () => {
    const { service, courses } = build({
      policy: { prerequisiteEnforcement: 'WARN' },
      prerequisite: { satisfied: false, unmet: [{ code: 'CSC101', message: 'not passed' }] },
    });
    await expect(service.submit('reg1', owner)).resolves.toMatchObject({ id: 'reg1' });
    expect(courses.prerequisiteStatus).not.toHaveBeenCalled();
  });
});

/**
 * The approval chain is DATA: the active REGISTRATION stages in sequence order.
 * An institution that wants adviser → HOD → dean adds a row; one that wants a
 * single signature deletes two. What the tests pin is that authority is checked
 * against the STAGE's role at a scope containing the student, and that a
 * rejection returns the seats immediately.
 */
describe('RegistrationService.decide', () => {
  const pending = (over: Record<string, unknown> = {}) =>
    registration({ status: 'PENDING_APPROVAL', ...over });
  const adviser = scoped('registration.approve', { userId: 'u-adviser' });
  const hod = scoped('registration.approve', { userId: 'u-hod' });
  const APPROVE = { decision: 'APPROVED' as const };

  it('refuses anything that is not awaiting approval', async () => {
    const { service } = build();
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /only a registration awaiting approval can be decided; this one is draft/i,
    );
  });

  it('refuses a student approving their own registration', async () => {
    const { service } = build({ registration: pending() });
    await expect(service.decide('reg1', owner, APPROVE)).rejects.toThrow(
      /cannot approve your own registration/i,
    );
  });

  /** The student has to know what to fix before resubmitting. */
  it('requires a reason on a rejection', async () => {
    const { service } = build({ registration: pending() });
    await expect(
      service.decide('reg1', adviser, { decision: 'REJECTED', comment: '   ' }),
    ).rejects.toThrow(/a rejection must say why/i);
  });

  it('refuses to decide anything when no chain is configured', async () => {
    const { service } = build({ registration: pending(), stages: [] });
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /no registration approval chain is configured/i,
    );
  });

  it('reports a registration every stage has already approved', async () => {
    const { service } = build({
      registration: pending({
        approvals: [
          approval(),
          approval({ id: 'apr-2', stageId: 'stg-hod', decidedById: 'u-hod' }),
        ],
      }),
    });
    await expect(service.decide('reg1', hod, APPROVE)).rejects.toThrow(
      /every approval stage has already approved/i,
    );
  });

  it('advances to the first stage that has not approved yet', async () => {
    const { service, prisma, tx } = build({ registration: pending({ approvals: [approval()] }) });
    await service.decide('reg1', hod, APPROVE);
    expect((prisma.roleAssignment.findMany as jest.Mock).mock.calls[0][0].where).toEqual({
      userId: 'u-hod',
      roleId: 'role-hod',
    });
    expect((tx.registrationApproval.create as jest.Mock).mock.calls[0][0].data).toMatchObject({
      stageId: 'stg-hod',
      decision: 'APPROVED',
      decidedById: 'u-hod',
    });
  });

  it('asks only for the ACTIVE stages, in sequence', async () => {
    const { service, prisma } = build({ registration: pending() });
    await service.decide('reg1', adviser, APPROVE);
    expect((prisma.approvalStage.findMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { domain: 'REGISTRATION', isActive: true },
      orderBy: { sequence: 'asc' },
    });
  });

  /** "The HOD of THIS department approves", not "anyone who can approve
   *  something" — so the check is against role assignments, not the flat
   *  permission set. */
  it('refuses an actor who does not hold the stage’s role', async () => {
    const { service } = build({ registration: pending(), assignments: [] });
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /only the ADVISER may act at this approval stage/i,
    );
  });

  it('refuses an actor who holds the role in another department', async () => {
    const { service } = build({
      registration: pending(),
      assignments: [
        { scopeType: 'DEPARTMENT', facultyId: null, departmentId: 'dep-other', programmeId: null },
      ],
    });
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /outside your assigned scope/i,
    );
  });

  /** How a single-signature setup works without inventing a role for it. */
  it('falls back to the approve permission’s own scope when a stage names no role', async () => {
    const { service, prisma } = build({
      registration: pending(),
      stages: [{ ...ADVISER_STAGE, requiredRoleId: null }],
    });
    await service.decide('reg1', adviser, APPROVE);
    expect(prisma.roleAssignment.findMany).not.toHaveBeenCalled();
  });

  /** docs/02 §5.4, checked across the WHOLE cycle rather than only the previous
   *  stage: someone who is both adviser and acting HOD must hand the second
   *  signature to someone else, or the chain is one person twice. */
  it('refuses an actor who already acted at an earlier stage', async () => {
    const { service } = build({ registration: pending({ approvals: [approval()] }) });
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /already acted on this registration at an earlier stage/i,
    );
  });

  it('leaves a non-final approval pending, holding its seats', async () => {
    const { service, tx } = build({ registration: pending() });
    await service.decide('reg1', adviser, { decision: 'APPROVED', comment: '  Looks right  ' });
    expect((tx.registrationApproval.create as jest.Mock).mock.calls[0][0].data.comment).toBe(
      'Looks right',
    );
    expect(tx.registration.update).not.toHaveBeenCalled();
    expect(released(tx)).toEqual([]);
  });

  it('approves outright once the final stage signs', async () => {
    const { service, tx } = build({ registration: pending({ approvals: [approval()] }) });
    await service.decide('reg1', hod, APPROVE);
    const data = (tx.registration.update as jest.Mock).mock.calls[0][0].data;
    expect(data.status).toBe('APPROVED');
    expect(data.approvedAt).toBeInstanceOf(Date);
  });

  /** A rejected registration holds nothing: the seat belongs to whoever is still
   *  choosing, not to a sweep job that may never run. */
  it('releases every seat on rejection and records why', async () => {
    const { service, tx, audit } = build({
      registration: pending({ lines: [lineB(), line()] }),
    });
    await service.decide('reg1', adviser, { decision: 'REJECTED', comment: 'Missing GST 201' });
    expect(released(tx)).toEqual([OFF_A, OFF_B]);
    expect((tx.registration.update as jest.Mock).mock.calls[0][0].data).toEqual({
      status: 'REJECTED',
      rejectReason: 'Missing GST 201',
      approvedAt: null,
    });
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'registration.reject',
        after: expect.objectContaining({ stage: 'ADVISER', seatsReleased: 2 }),
      }),
    );
  });

  it('refuses when the registration was decided a moment ago', async () => {
    const { service } = build({ registration: pending(), freshStatus: 'APPROVED' });
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(/decided a moment ago/i);
  });

  it('tells the second of two approvers at one stage that it is already decided', async () => {
    const { service, tx } = build({ registration: pending() });
    (tx.registrationApproval.create as jest.Mock).mockRejectedValue(p2002());
    await expect(service.decide('reg1', adviser, APPROVE)).rejects.toThrow(
      /ADVISER has already been decided on this registration/i,
    );
  });
});

/**
 * The point of no return (INV-9). Seats stay held — a locked registration is the
 * strongest claim on one — and the lines freeze, which is what makes the credit
 * units already snapshotted on them the numbers the semester is graded against.
 */
describe('RegistrationService.lock', () => {
  const approvedChain = [
    approval(),
    approval({
      id: 'apr-2',
      stageId: 'stg-hod',
      decidedById: 'u-hod',
      stage: { id: 'stg-hod', key: 'HOD', sequence: 2 },
    }),
  ];
  const approved = (over: Record<string, unknown> = {}) =>
    registration({ status: 'APPROVED', approvals: approvedChain, ...over });
  const registrar = scoped('registration.lock', { userId: 'u-registrar' });

  it('is idempotent once locked', async () => {
    const { service, prisma } = build({ registration: registration({ status: 'LOCKED' }) });
    await expect(service.lock('reg1', registrar)).resolves.toMatchObject({ id: 'reg1' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to lock anything that is not approved', async () => {
    const { service } = build();
    await expect(service.lock('reg1', registrar)).rejects.toThrow(
      /only an approved registration can be locked; this one is draft/i,
    );
  });

  it('scope-checks the locker against the student’s location', async () => {
    const outsider = principal({
      permissions: ['registration.lock'],
      scopedPermissions: [
        {
          permission: 'registration.lock',
          scope: { scopeType: 'DEPARTMENT', departmentId: 'dep-other' },
        },
      ],
    });
    const { service } = build({ registration: approved() });
    await expect(service.lock('reg1', outsider)).rejects.toThrow(/outside your assigned scope/i);
  });

  /** Four eyes on an irreversible step. */
  it('refuses the officer who gave the final approval', async () => {
    const { service } = build({ registration: approved() });
    await expect(
      service.lock('reg1', scoped('registration.lock', { userId: 'u-hod' })),
    ).rejects.toThrow(/gave the final approval.*someone else must lock it/is);
  });

  it('allows an earlier approver who was not the last one', async () => {
    const { service } = build({ registration: approved() });
    await expect(
      service.lock('reg1', scoped('registration.lock', { userId: 'u-adviser' })),
    ).resolves.toMatchObject({ id: 'reg1' });
  });

  it('locks the registration and records who closed the door, and on what', async () => {
    const { service, tx, audit } = build({
      registration: approved({ lines: [line(), lineB({ state: 'DROPPED' })], totalUnits: 3 }),
    });
    await service.lock('reg1', registrar);
    const data = (tx.registration.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'LOCKED', lockedById: 'u-registrar' });
    expect(data.lockedAt).toBeInstanceOf(Date);
    // Only the ACTIVE lines: a dropped course is history, not part of the lock.
    expect(audit.recordTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'registration.lock',
        after: expect.objectContaining({ courses: ['CSC201'], totalUnits: 3 }),
      }),
    );
  });

  it('refuses when the approval was withdrawn a moment ago', async () => {
    const { service } = build({ registration: approved(), freshStatus: 'REJECTED' });
    await expect(service.lock('reg1', registrar)).rejects.toThrow(
      /no longer in an approved state/i,
    );
  });

  it('keeps the seats held — a lock is the strongest claim on one', async () => {
    const { service, tx } = build({ registration: approved() });
    await service.lock('reg1', registrar);
    expect(released(tx)).toEqual([]);
    expect(claimed(tx)).toEqual([]);
  });
});
