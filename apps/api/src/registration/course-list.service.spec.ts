import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CourseListService } from './course-list.service';
import { RegistrationPolicyService } from './registration-policy.service';
import { DEFAULT_REGISTRATION_POLICY, RegistrationPolicy } from './registration.constants';

/**
 * The §9.2 list. The behaviours that matter are the ones a student would
 * otherwise have to phone the department about:
 *
 *   • a course that is not on the list says WHY (passed, not offered,
 *     prerequisite unmet, result pending, withdrawn) instead of vanishing;
 *   • carryovers come from the whole history, arrive ticked, and are not removable;
 *   • a withheld result is neither a pass nor a carryover — guessing either way
 *     has consequences;
 *   • prerequisites are compared on GRADE POINTS, because 'B' means different
 *     things on different scales;
 *   • the policy decides whether an unmet prerequisite or a full offering excludes
 *     the course outright or merely warns.
 */
const dec = (n: string) => new Prisma.Decimal(n);

const FIVE_POINT = [
  { grade: 'A', gradePoint: dec('5'), scale: { isDefault: true } },
  { grade: 'B', gradePoint: dec('4'), scale: { isDefault: true } },
  { grade: 'C', gradePoint: dec('3'), scale: { isDefault: true } },
  { grade: 'D', gradePoint: dec('2'), scale: { isDefault: true } },
  { grade: 'E', gradePoint: dec('1'), scale: { isDefault: true } },
  { grade: 'F', gradePoint: dec('0'), scale: { isDefault: true } },
];

const course = (over: Record<string, unknown> = {}) => ({
  id: 'crs-csc101',
  code: 'CSC101',
  title: 'Intro to Computing',
  creditUnits: 3,
  level: 100,
  isActive: true,
  departmentId: 'dep-csc',
  category: { key: 'CORE' },
  prerequisites: [],
  ...over,
});

const requirement = (over: Record<string, unknown> = {}) => ({
  courseId: 'crs-csc101',
  requirementType: 'COMPULSORY',
  creditUnits: null,
  electiveGroup: null,
  ...over,
});

const offering = (over: Record<string, unknown> = {}) => ({
  id: 'off-csc101',
  courseId: 'crs-csc101',
  capacity: 50,
  seatsTaken: 10,
  ...over,
});

const grade = (over: Record<string, unknown> = {}) => ({
  courseId: 'crs-csc101',
  grade: 'A',
  gradePoint: dec('5'),
  mark: 'NORMAL',
  publishedAt: new Date('2025-07-01T00:00:00Z'),
  ...over,
});

function build(
  over: {
    student?: Record<string, unknown> | null;
    semester?: Record<string, unknown> | null;
    requirements?: Array<Record<string, unknown>>;
    grades?: Array<Record<string, unknown>>;
    courses?: Array<Record<string, unknown>>;
    offerings?: Array<Record<string, unknown>>;
    lines?: Array<Record<string, unknown>>;
    bands?: Array<Record<string, unknown>>;
    policy?: Partial<RegistrationPolicy>;
  } = {},
) {
  const prisma = {
    studentRecord: {
      findUnique: jest.fn().mockResolvedValue(
        over.student === null
          ? null
          : (over.student ?? {
              id: 'stu1',
              currentLevel: 100,
              curriculumVersionId: 'cv1',
              curriculumVersion: { id: 'cv1', name: 'CSC 2024', status: 'PUBLISHED' },
            }),
      ),
    },
    semester: {
      findUnique: jest.fn().mockResolvedValue(
        over.semester === null
          ? null
          : (over.semester ?? {
              id: 'sem1',
              sequence: 1,
              name: 'First Semester',
              sessionId: 'ses1',
            }),
      ),
    },
    curriculumRequirement: {
      findMany: jest.fn().mockResolvedValue(over.requirements ?? [requirement()]),
    },
    gradeRecord: { findMany: jest.fn().mockResolvedValue(over.grades ?? []) },
    gradeBand: { findMany: jest.fn().mockResolvedValue(over.bands ?? FIVE_POINT) },
    course: {
      findMany: jest.fn().mockResolvedValue(over.courses ?? [course()]),
      findUnique: jest.fn().mockResolvedValue(over.courses?.[0] ?? course()),
    },
    courseOffering: { findMany: jest.fn().mockResolvedValue(over.offerings ?? [offering()]) },
    registrationLine: { findMany: jest.fn().mockResolvedValue(over.lines ?? []) },
  } as unknown as PrismaService;

  const policyService = {
    get: jest.fn().mockResolvedValue({ ...DEFAULT_REGISTRATION_POLICY, ...over.policy }),
  } as unknown as RegistrationPolicyService;

  return { service: new CourseListService(prisma, policyService), prisma };
}

describe('CourseListService.build', () => {
  it('lists a required course that has an open offering', async () => {
    const { service } = build();
    const list = await service.build('stu1', 'ses1', 'sem1');
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      offeringId: 'off-csc101',
      code: 'CSC101',
      lineType: 'NEW',
      requirementType: 'COMPULSORY',
      preSelected: true,
      removable: true,
      selectable: true,
      alreadyRegistered: false,
    });
    expect(list.excluded).toEqual([]);
  });

  it('prefers the curriculum’s unit override over the course’s own', async () => {
    const { service } = build({ requirements: [requirement({ creditUnits: 4 })] });
    const list = await service.build('stu1', 'ses1', 'sem1');
    expect(list.items[0].creditUnits).toBe(4);
    expect(list.totals.preSelectedUnits).toBe(4);
  });

  it('marks a course the student has already registered this semester', async () => {
    const { service } = build({ lines: [{ courseOfferingId: 'off-csc101' }] });
    const list = await service.build('stu1', 'ses1', 'sem1');
    expect(list.items[0].alreadyRegistered).toBe(true);
  });

  it('refuses a semester that belongs to another session rather than guessing', async () => {
    const { service } = build({
      semester: { id: 'sem1', sequence: 1, name: 'First Semester', sessionId: 'ses-other' },
    });
    await expect(service.build('stu1', 'ses1', 'sem1')).rejects.toThrow(
      /does not belong to the requested session/i,
    );
  });

  it('reports a missing student', async () => {
    const { service } = build({ student: null });
    await expect(service.build('ghost', 'ses1', 'sem1')).rejects.toThrow(NotFoundException);
  });

  it('asks only for OPEN offerings — a draft offering is not published to students', async () => {
    const { service, prisma } = build();
    await service.build('stu1', 'ses1', 'sem1');
    expect((prisma.courseOffering.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
      sessionId: 'ses1',
      semesterId: 'sem1',
      status: 'OPEN',
    });
  });

  describe('exclusions', () => {
    it('excludes a passed course and says so', async () => {
      const { service } = build({ grades: [grade()] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items).toEqual([]);
      expect(list.excluded[0]).toMatchObject({ reason: 'ALREADY_PASSED', code: 'CSC101' });
      expect(list.excluded[0].message).toMatch(/passed CSC101 with a A/);
    });

    it('lists a passed course as a REPEAT when the policy permits an upgrade', async () => {
      const { service } = build({ grades: [grade()], policy: { allowRepeatForUpgrade: true } });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0]).toMatchObject({ lineType: 'REPEAT', attempts: 1, lastGrade: 'A' });
      expect(list.items[0].warnings.join(' ')).toMatch(/recorded as a repeat/i);
    });

    /** A withheld result is undecided: neither a pass to hide, nor a failure to force. */
    it('excludes a course whose result is withheld, distinctly from a failure', async () => {
      const { service } = build({
        grades: [grade({ grade: null, gradePoint: null, mark: 'WITHHELD' })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0].reason).toBe('RESULT_PENDING');
      expect(list.excluded[0].message).toMatch(/cannot be treated as passed or as a carryover/i);
    });

    it('treats an unpublished record as undecided, so a mark cannot leak early', async () => {
      const { service } = build({
        grades: [grade({ grade: 'F', gradePoint: dec('0'), publishedAt: null })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0].reason).toBe('RESULT_PENDING');
    });

    it('reports a required course with no open offering instead of dropping it silently', async () => {
      const { service } = build({ offerings: [] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0]).toMatchObject({ reason: 'NO_OFFERING' });
      expect(list.excluded[0].message).toMatch(/no open offering in First Semester/i);
    });

    it('tells a carryover student their outstanding course is not offered this semester', async () => {
      const { service } = build({
        requirements: [],
        grades: [grade({ grade: 'F', gradePoint: dec('0') })],
        offerings: [],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0].message).toMatch(/carryover but is not being offered/i);
    });

    it('excludes a withdrawn course and points at the department', async () => {
      const { service } = build({ courses: [course({ isActive: false })] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0]).toMatchObject({ reason: 'COURSE_INACTIVE' });
      expect(list.excluded[0].message).toMatch(/withdrawn from the catalogue/i);
    });
  });

  describe('carryovers (R5)', () => {
    const failed = () => ({
      requirements: [],
      grades: [grade({ courseId: 'crs-mth101', grade: 'F', gradePoint: dec('0') })],
      courses: [course({ id: 'crs-mth101', code: 'MTH101', title: 'Algebra' })],
      offerings: [offering({ id: 'off-mth101', courseId: 'crs-mth101' })],
    });

    it('includes an outstanding course from an earlier level, ticked and locked', async () => {
      const { service } = build(failed());
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0]).toMatchObject({
        code: 'MTH101',
        lineType: 'CARRYOVER',
        preSelected: true,
        removable: false,
        requirementType: null,
        attempts: 1,
        lastGrade: 'F',
      });
      expect(list.totals).toMatchObject({ carryoverCount: 1, carryoverUnits: 3 });
    });

    it('treats a zero grade point as a failure whatever the letter says', async () => {
      const { service } = build({
        ...failed(),
        grades: [grade({ courseId: 'crs-mth101', grade: 'Z', gradePoint: dec('0') })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].lineType).toBe('CARRYOVER');
    });

    it('treats ABSENT and MEDICAL as leaving the course outstanding', async () => {
      for (const mark of ['ABSENT', 'MEDICAL', 'MALPRACTICE']) {
        const { service } = build({
          ...failed(),
          grades: [grade({ courseId: 'crs-mth101', grade: null, gradePoint: null, mark })],
        });
        const list = await service.build('stu1', 'ses1', 'sem1');
        expect(list.items[0].lineType).toBe('CARRYOVER');
      }
    });

    /** A pass is permanent: a later failed retake does not un-pass a course. */
    it('keeps a course passed once any attempt passed it', async () => {
      const { service } = build({
        grades: [grade(), grade({ grade: 'F', gradePoint: dec('0') })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.excluded[0].reason).toBe('ALREADY_PASSED');
    });

    it('reads only current records, so an amended result is not counted twice', async () => {
      const { service, prisma } = build();
      await service.build('stu1', 'ses1', 'sem1');
      expect((prisma.gradeRecord.findMany as jest.Mock).mock.calls[0][0].where).toMatchObject({
        supersededById: null,
      });
    });

    it('sorts carryovers ahead of compulsory courses', async () => {
      const { service } = build({
        requirements: [requirement()],
        grades: [grade({ courseId: 'crs-mth101', grade: 'F', gradePoint: dec('0') })],
        courses: [course(), course({ id: 'crs-mth101', code: 'MTH101', title: 'Algebra' })],
        offerings: [offering(), offering({ id: 'off-mth101', courseId: 'crs-mth101' })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items.map((i) => i.code)).toEqual(['MTH101', 'CSC101']);
    });
  });

  describe('prerequisites', () => {
    const withPrereq = (minGrade: string | null = null) => ({
      courses: [
        course({
          prerequisites: [
            {
              minGrade,
              prerequisiteCourse: { id: 'crs-mth101', code: 'MTH101', title: 'Algebra' },
            },
          ],
        }),
      ],
    });

    it('excludes the course under BLOCK and names what is missing', async () => {
      const { service } = build(withPrereq());
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items).toEqual([]);
      expect(list.excluded[0]).toMatchObject({ reason: 'PREREQUISITE_UNMET' });
      expect(list.excluded[0].message).toMatch(/requires MTH101.*not taken MTH101/i);
    });

    it('lists the course with a warning under WARN, and leaves it selectable', async () => {
      const { service } = build({ ...withPrereq(), policy: { prerequisiteEnforcement: 'WARN' } });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].selectable).toBe(true);
      expect(list.items[0].prerequisites.satisfied).toBe(false);
      expect(list.items[0].prerequisites.unmet[0]).toMatchObject({
        code: 'MTH101',
        status: 'NOT_TAKEN',
      });
      expect(list.items[0].warnings.join(' ')).toMatch(/Prerequisite not satisfied: MTH101/);
    });

    it('distinguishes not-taken from not-passed from result-pending', async () => {
      const cases: Array<[Record<string, unknown> | null, string]> = [
        [null, 'NOT_TAKEN'],
        [{ courseId: 'crs-mth101', grade: 'F', gradePoint: dec('0') }, 'NOT_PASSED'],
        [
          { courseId: 'crs-mth101', grade: null, gradePoint: null, mark: 'WITHHELD' },
          'RESULT_PENDING',
        ],
      ];
      for (const [record, status] of cases) {
        const { service } = build({
          ...withPrereq(),
          policy: { prerequisiteEnforcement: 'WARN' },
          grades: record ? [grade(record)] : [],
        });
        const list = await service.build('stu1', 'ses1', 'sem1');
        expect(list.items[0].prerequisites.unmet[0].status).toBe(status);
      }
    });

    /** Compared on points, not letters: 'C' is not below 'B' by alphabet. */
    it('fails a minGrade the student passed below', async () => {
      const { service } = build({
        ...withPrereq('B'),
        policy: { prerequisiteEnforcement: 'WARN' },
        grades: [grade({ courseId: 'crs-mth101', grade: 'C', gradePoint: dec('3') })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].prerequisites.unmet[0]).toMatchObject({
        status: 'GRADE_TOO_LOW',
        minGrade: 'B',
      });
      expect(list.items[0].prerequisites.unmet[0].message).toMatch(
        /at B or better.*your best grade is C/i,
      );
    });

    it('satisfies a minGrade the student met exactly', async () => {
      const { service } = build({
        ...withPrereq('C'),
        grades: [grade({ courseId: 'crs-mth101', grade: 'C', gradePoint: dec('3') })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].prerequisites.satisfied).toBe(true);
    });

    /** A letter the current scale does not know degrades to "must have passed". */
    it('degrades an unknown minGrade to a bare pass requirement', async () => {
      const { service } = build({
        ...withPrereq('A1'),
        grades: [grade({ courseId: 'crs-mth101', grade: 'E', gradePoint: dec('1') })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].prerequisites.satisfied).toBe(true);
    });
  });

  describe('capacity', () => {
    it('reports seats and blocks a full offering when capacity is enforced', async () => {
      const { service } = build({ offerings: [offering({ capacity: 10, seatsTaken: 10 })] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].capacity).toEqual({
        capacity: 10,
        seatsTaken: 10,
        seatsAvailable: 0,
        isFull: true,
      });
      expect(list.items[0].selectable).toBe(false);
      expect(list.totals.selectableUnits).toBe(0);
    });

    it('keeps a full offering selectable when the policy only warns', async () => {
      const { service } = build({
        offerings: [offering({ capacity: 10, seatsTaken: 10 })],
        policy: { enforceCapacity: false },
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].selectable).toBe(true);
      expect(list.items[0].warnings.join(' ')).toMatch(/over its nominal capacity/i);
    });

    /** Null capacity is uncapped, which is not the same as zero seats left. */
    it('leaves seatsAvailable null for an uncapped offering', async () => {
      const { service } = build({ offerings: [offering({ capacity: null, seatsTaken: 400 })] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.items[0].capacity).toMatchObject({ seatsAvailable: null, isFull: false });
    });
  });

  describe('curriculum warnings', () => {
    it('warns when no curriculum is pinned, and lists outstanding courses only', async () => {
      const { service, prisma } = build({
        student: {
          id: 'stu1',
          currentLevel: 100,
          curriculumVersionId: null,
          curriculumVersion: null,
        },
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(prisma.curriculumRequirement.findMany).not.toHaveBeenCalled();
      expect(list.warnings.join(' ')).toMatch(/no curriculum version is pinned/i);
      expect(list.items).toEqual([]);
    });

    it('warns when the pinned curriculum is not published', async () => {
      const { service } = build({
        student: {
          id: 'stu1',
          currentLevel: 100,
          curriculumVersionId: 'cv1',
          curriculumVersion: { id: 'cv1', name: 'CSC 2024', status: 'DRAFT' },
        },
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.warnings.join(' ')).toMatch(/is draft, not published/i);
    });

    it('warns when the curriculum defines nothing for this level and semester', async () => {
      const { service } = build({ requirements: [] });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.warnings.join(' ')).toMatch(/defines no courses for 100 level/i);
      expect(list.items).toEqual([]);
      expect(list.totals.carryoverCount).toBe(0);
    });

    it('groups electives so a client can enforce "choose N from this group"', async () => {
      const { service } = build({
        requirements: [
          requirement({ requirementType: 'ELECTIVE', electiveGroup: 'GST' }),
          requirement({
            courseId: 'crs-gst102',
            requirementType: 'ELECTIVE',
            electiveGroup: 'GST',
          }),
        ],
        courses: [course(), course({ id: 'crs-gst102', code: 'GST102', title: 'Use of English' })],
        offerings: [offering(), offering({ id: 'off-gst102', courseId: 'crs-gst102' })],
      });
      const list = await service.build('stu1', 'ses1', 'sem1');
      expect(list.electiveGroups).toEqual([{ group: 'GST', offered: 2 }]);
      expect(list.items.every((i) => i.lineType === 'ELECTIVE')).toBe(true);
      expect(list.items.every((i) => i.preSelected === false)).toBe(true);
    });
  });
});

describe('CourseListService.prerequisiteStatus', () => {
  it('answers for one course, for the paths that bypass the list', async () => {
    const { service } = build({
      courses: [
        course({
          prerequisites: [
            {
              minGrade: null,
              prerequisiteCourse: { id: 'crs-mth101', code: 'MTH101', title: 'Algebra' },
            },
          ],
        }),
      ],
    });
    const verdict = await service.prerequisiteStatus('stu1', 'crs-csc101');
    expect(verdict.satisfied).toBe(false);
    expect(verdict.unmet[0].code).toBe('MTH101');
  });

  it('reports a course that does not exist', async () => {
    const { service, prisma } = build();
    (prisma.course.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.prerequisiteStatus('stu1', 'ghost')).rejects.toThrow(NotFoundException);
  });
});
