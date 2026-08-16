/**
 * Database seed (idempotent). Run AFTER `prisma migrate` and `guards.sql`:
 *
 *   npm run prisma:deploy && psql "$DATABASE_ADMIN_URL" -f prisma/guards.sql && npm run seed
 *
 * What it writes:
 *   • FOUNDATIONAL (always): the permission catalog, the system roles + their
 *     role→permission links, the student-status vocabulary, the academic
 *     reference data (course categories, the default grading scale, the credit
 *     policy), the REGISTRATION approval chain (adviser → HOD), and ONE bootstrap
 *     SUPER_ADMIN read from BOOTSTRAP_ADMIN_* env (never hardcoded).
 *   • DEMO (gated by SEED_DEMO): a small university structure, a handful of
 *     PENDING demo student master records for exercising activation/dashboards,
 *     and a worked academic example — semesters, a course catalogue with
 *     prerequisites, a published curriculum, and first-semester offerings.
 *     Demo data is skipped in production unless SEED_DEMO=true is set explicitly,
 *     so no fake data can slip into a real deployment.
 *
 * Every write is an upsert keyed on a natural unique, so re-running is safe.
 *
 * Two things the seed deliberately will NOT do on re-run, mirroring the rules
 * AcademicConfigService enforces at runtime: it never steals `isDefault` from a
 * grading scale an administrator has chosen, and it never rewrites the bands of
 * a scale that has already graded something (a GradeRecord pins the scale id,
 * not a snapshot of its bands, so an in-place edit would re-grade history).
 */
import {
  ActivationState,
  ApprovalDomain,
  CurriculumStatus,
  EntryMode,
  Gender,
  OfferingStatus,
  Prisma,
  PrismaClient,
  RequirementType,
  ScopeType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_DEFS } from '../src/rbac/permissions.catalog';
import { ROLE_DEFS } from '../src/rbac/roles.catalog';
import {
  CREDIT_POLICY_KEY,
  DEFAULT_CREDIT_POLICY,
} from '../src/academics/academic-config.constants';

const prisma = new PrismaClient();

/** argon2id parameters — kept in lockstep with PasswordService.hash(). */
function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

function seedDemo(): boolean {
  if (process.env.SEED_DEMO === 'true') return true;
  if (process.env.SEED_DEMO === 'false') return false;
  // Default: on outside production, off in production.
  return process.env.NODE_ENV !== 'production';
}

// --- Foundational -----------------------------------------------------------

/** Upsert every permission in the catalog. */
async function seedPermissions(): Promise<Map<string, string>> {
  const byKey = new Map<string, string>();
  for (const def of PERMISSION_DEFS) {
    const perm = await prisma.permission.upsert({
      where: { key: def.key },
      create: { key: def.key, description: def.description, category: def.category },
      update: { description: def.description, category: def.category },
    });
    byKey.set(def.key, perm.id);
  }
  console.log(`  permissions: ${byKey.size} upserted`);
  return byKey;
}

/** Upsert every system role and (re)synchronise its permission set. */
async function seedRoles(permIdByKey: Map<string, string>): Promise<void> {
  for (const def of ROLE_DEFS) {
    const role = await prisma.role.upsert({
      where: { key: def.key },
      create: {
        key: def.key,
        name: def.name,
        description: def.description,
        scopeKind: def.scopeKind,
        isSystem: true,
      },
      update: { name: def.name, description: def.description, scopeKind: def.scopeKind },
    });

    // Resolve the role's permission ids, then converge the join table to exactly
    // that set (add missing, remove stale) so edits to the catalog take effect.
    const wantIds = def.permissions
      .map((k) => permIdByKey.get(k))
      .filter((id): id is string => Boolean(id));
    const wanted = new Set(wantIds);

    const existing = await prisma.rolePermission.findMany({
      where: { roleId: role.id },
      select: { permissionId: true },
    });
    const have = new Set(existing.map((e) => e.permissionId));

    const toAdd = [...wanted].filter((id) => !have.has(id));
    const toRemove = [...have].filter((id) => !wanted.has(id));

    if (toAdd.length) {
      await prisma.rolePermission.createMany({
        data: toAdd.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
    if (toRemove.length) {
      await prisma.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { in: toRemove } },
      });
    }
    console.log(
      `  role ${def.key}: ${wanted.size} permission(s) (+${toAdd.length}/-${toRemove.length})`,
    );
  }
}

/** The configurable student lifecycle statuses (data, not hardcoded branches). */
async function seedStudentStatuses(): Promise<string> {
  const statuses = [
    { key: 'ACTIVE', label: 'Active', isTerminal: false, allowsLogin: true, sortOrder: 10 },
    { key: 'DEFERRED', label: 'Deferred', isTerminal: false, allowsLogin: true, sortOrder: 20 },
    {
      key: 'SUSPENDED',
      label: 'Suspended',
      isTerminal: false,
      allowsLogin: false,
      sortOrder: 30,
    },
    {
      key: 'WITHDRAWN',
      label: 'Withdrawn',
      isTerminal: true,
      allowsLogin: false,
      sortOrder: 40,
    },
    {
      key: 'GRADUATED',
      label: 'Graduated',
      isTerminal: true,
      allowsLogin: false,
      sortOrder: 50,
    },
    { key: 'EXPELLED', label: 'Expelled', isTerminal: true, allowsLogin: false, sortOrder: 60 },
  ];
  let activeId = '';
  for (const s of statuses) {
    const row = await prisma.studentStatus.upsert({
      where: { key: s.key },
      create: s,
      update: {
        label: s.label,
        isTerminal: s.isTerminal,
        allowsLogin: s.allowsLogin,
        sortOrder: s.sortOrder,
      },
    });
    if (s.key === 'ACTIVE') activeId = row.id;
  }
  console.log(`  student statuses: ${statuses.length} upserted`);
  return activeId;
}

/**
 * The course-classification vocabulary. Data rather than an enum so a faculty
 * can add its own without a deployment; these are the classifications almost
 * every Nigerian university needs on day one.
 */
async function seedCourseCategories(): Promise<void> {
  const categories = [
    { key: 'CORE', label: 'Core', description: 'Compulsory to the programme', sortOrder: 10 },
    {
      key: 'GST',
      label: 'General Studies',
      description: 'University-wide requirement, owned by no department',
      sortOrder: 20,
    },
    {
      key: 'FACULTY_ELECTIVE',
      label: 'Faculty Elective',
      description: 'Chosen from within the faculty',
      sortOrder: 30,
    },
    {
      key: 'DEPARTMENTAL_ELECTIVE',
      label: 'Departmental Elective',
      description: 'Chosen from within the department',
      sortOrder: 40,
    },
    {
      key: 'SERVICE',
      label: 'Service Course',
      description: 'Taught by one department for another',
      sortOrder: 50,
    },
    { key: 'PROJECT', label: 'Project / Research', sortOrder: 60 },
    { key: 'SIWES', label: 'Industrial Training', sortOrder: 70 },
  ];

  for (const c of categories) {
    await prisma.courseCategory.upsert({
      where: { key: c.key },
      create: c,
      // isActive is left alone: a category an institution has retired must stay
      // retired across re-seeds.
      update: { label: c.label, description: c.description ?? null, sortOrder: c.sortOrder },
    });
  }
  console.log(`  course categories: ${categories.length} upserted`);
}

/**
 * The default 5-point grading scale.
 *
 * Bands cover 0-100 with no gap and no overlap, inclusive at both ends, which is
 * exactly what AcademicConfigService.validateBands demands — seeding anything
 * else would produce a scale the config UI then refuses to save.
 */
async function seedGradeScale(): Promise<void> {
  const KEY = 'FIVE_POINT';
  const bands = [
    { grade: 'A', minScore: 70, maxScore: 100, gradePoint: 5, sortOrder: 0 },
    { grade: 'B', minScore: 60, maxScore: 69, gradePoint: 4, sortOrder: 1 },
    { grade: 'C', minScore: 50, maxScore: 59, gradePoint: 3, sortOrder: 2 },
    { grade: 'D', minScore: 45, maxScore: 49, gradePoint: 2, sortOrder: 3 },
    { grade: 'E', minScore: 40, maxScore: 44, gradePoint: 1, sortOrder: 4 },
    { grade: 'F', minScore: 0, maxScore: 39, gradePoint: 0, sortOrder: 5 },
  ];

  const scale = await prisma.gradeScale.upsert({
    where: { key: KEY },
    create: {
      key: KEY,
      name: '5-Point Scale',
      description: 'A=5 … F=0, the common Nigerian undergraduate scale',
      // Claim the default only on a fresh install. On re-run the flag is left
      // as-is below, so an administrator's choice of scale survives seeding.
      isDefault: (await prisma.gradeScale.count({ where: { isDefault: true } })) === 0,
    },
    update: { name: '5-Point Scale' },
  });

  const graded = await prisma.gradeRecord.count({ where: { gradeScaleId: scale.id } });
  if (graded > 0) {
    console.log(`  grade scale ${KEY}: bands left untouched (${graded} record(s) already graded)`);
    return;
  }

  for (const b of bands) {
    await prisma.gradeBand.upsert({
      where: { scaleId_grade: { scaleId: scale.id, grade: b.grade } },
      create: { ...b, scaleId: scale.id },
      update: {
        minScore: b.minScore,
        maxScore: b.maxScore,
        gradePoint: b.gradePoint,
        sortOrder: b.sortOrder,
      },
    });
  }
  console.log(
    `  grade scale ${KEY}: ${bands.length} band(s)${scale.isDefault ? ' (default)' : ''}`,
  );
}

/**
 * The credit policy (INV-8: min/max units registrable per semester).
 *
 * Created only when absent. An institution that has tuned its limits must not
 * have them reset to the shipped default by a re-seed.
 */
async function seedCreditPolicy(): Promise<void> {
  const existing = await prisma.systemConfig.findUnique({ where: { key: CREDIT_POLICY_KEY } });
  if (existing) {
    console.log(`  credit policy: already configured (${JSON.stringify(existing.value)})`);
    return;
  }
  await prisma.systemConfig.create({
    data: {
      key: CREDIT_POLICY_KEY,
      value: { ...DEFAULT_CREDIT_POLICY },
      description: 'Min/max credit units registrable per semester (INV-8)',
    },
  });
  console.log(
    `  credit policy: ${DEFAULT_CREDIT_POLICY.minUnits}-${DEFAULT_CREDIT_POLICY.maxUnits} units`,
  );
}

/**
 * The REGISTRATION approval chain (docs/03 §9.6, docs/02 §5.4).
 *
 * The chain is DATA: RegistrationService reads the active REGISTRATION stages in
 * `sequence` order and requires the actor to hold that stage's role at a scope
 * containing the student. Shipping two stages is a decision, not a limitation —
 * one signature would let a single person both approve and lock, which is exactly
 * the separation of duties the four registration permission keys exist to enforce.
 *
 * Stages are created only when absent, and an institution that has deactivated or
 * re-sequenced its chain keeps that: a re-seed must not silently re-open a stage
 * the registry closed. Names are refreshed, since those are only labels.
 */
async function seedRegistrationApprovalChain(): Promise<void> {
  const chain = [
    {
      sequence: 1,
      key: 'ADVISER',
      name: 'Academic Adviser',
      roleKey: 'ACADEMIC_ADVISER',
      // The adviser is measured against the student's DEPARTMENT: an adviser
      // approves their own advisees, not any student who happens to be in the
      // faculty.
      scopeKind: ScopeType.DEPARTMENT,
    },
    {
      sequence: 2,
      key: 'HOD',
      name: 'Head of Department',
      roleKey: 'HOD',
      scopeKind: ScopeType.DEPARTMENT,
    },
  ] as const;

  for (const stage of chain) {
    const role = await prisma.role.findUnique({
      where: { key: stage.roleKey },
      select: { id: true },
    });
    if (!role) throw new Error(`${stage.roleKey} role missing — seed roles first.`);

    // Keyed on (domain, key) rather than (domain, sequence): the key is the
    // stage's identity, and re-ordering a chain must not turn the adviser stage
    // into the HOD stage.
    const existing = await prisma.approvalStage.findUnique({
      where: { domain_key: { domain: ApprovalDomain.REGISTRATION, key: stage.key } },
      select: { id: true, sequence: true, isActive: true },
    });
    if (existing) {
      await prisma.approvalStage.update({
        where: { id: existing.id },
        data: { name: stage.name, requiredRoleId: role.id },
      });
      console.log(
        `  approval stage ${stage.key}: kept (sequence ${existing.sequence}, ${
          existing.isActive ? 'active' : 'inactive'
        })`,
      );
      continue;
    }
    await prisma.approvalStage.create({
      data: {
        domain: ApprovalDomain.REGISTRATION,
        sequence: stage.sequence,
        key: stage.key,
        name: stage.name,
        requiredRoleId: role.id,
        scopeKind: stage.scopeKind,
      },
    });
    console.log(`  approval stage ${stage.key}: created at sequence ${stage.sequence}`);
  }
}

/**
 * The RESULT approval chain (docs/03 §10.4).
 *
 * Same posture as the registration chain: an N-stage pipeline where the stages
 * are DATA, each bound to a role that must hold it at a scope containing the
 * offering's department. Shipping HOD → Dean is the strict reading of §10.4's
 * "at least three distinct hands" when the LECTURER is counted as the
 * originator (submit ≠ approve): the lecturer enters and submits, the HOD signs
 * the departmental stage, the Dean signs the faculty stage — and publication is
 * a separate dual-control act nobody in this chain performs alone.
 *
 * Stages are created only when absent; a re-seed never re-opens a stage an
 * institution deactivated (the same rule as the registration chain).
 */
async function seedResultApprovalChain(): Promise<void> {
  const chain = [
    {
      sequence: 1,
      key: 'HOD',
      name: 'Head of Department',
      roleKey: 'HOD',
      // A result batch belongs to a department-owned offering, so the HOD must
      // hold their assignment at (or above) the offering's department.
      scopeKind: ScopeType.DEPARTMENT,
    },
    {
      sequence: 2,
      key: 'DEAN',
      name: 'Dean',
      roleKey: 'DEAN',
      scopeKind: ScopeType.FACULTY,
    },
  ] as const;

  for (const stage of chain) {
    const role = await prisma.role.findUnique({
      where: { key: stage.roleKey },
      select: { id: true },
    });
    if (!role) throw new Error(`${stage.roleKey} role missing — seed roles first.`);

    const existing = await prisma.approvalStage.findUnique({
      where: { domain_key: { domain: ApprovalDomain.RESULT, key: stage.key } },
      select: { id: true, sequence: true, isActive: true },
    });
    if (existing) {
      await prisma.approvalStage.update({
        where: { id: existing.id },
        data: { name: stage.name, requiredRoleId: role.id },
      });
      console.log(
        `  result stage ${stage.key}: kept (sequence ${existing.sequence}, ${
          existing.isActive ? 'active' : 'inactive'
        })`,
      );
      continue;
    }
    await prisma.approvalStage.create({
      data: {
        domain: ApprovalDomain.RESULT,
        sequence: stage.sequence,
        key: stage.key,
        name: stage.name,
        requiredRoleId: role.id,
        scopeKind: stage.scopeKind,
      },
    });
    console.log(`  result stage ${stage.key}: created at sequence ${stage.sequence}`);
  }
}

/** Create the single bootstrap SUPER_ADMIN from env, forced to rotate on login. */
async function seedBootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const name = process.env.BOOTSTRAP_ADMIN_NAME ?? 'System Administrator';

  if (!email || !password) {
    console.warn(
      '  bootstrap admin: SKIPPED — set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD to create one.',
    );
    return;
  }

  const superAdminRole = await prisma.role.findUnique({ where: { key: 'SUPER_ADMIN' } });
  if (!superAdminRole) throw new Error('SUPER_ADMIN role missing — seed roles first.');

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: {
      userType: 'STAFF',
      email,
      passwordHash,
      fullName: name,
      isActive: true,
      mustChangePassword: true,
    },
    // Do NOT reset an existing admin's password/rotation flag on re-seed.
    update: { fullName: name },
  });

  // GLOBAL-scope assignment (scope columns null). Compound unique includes the
  // nulls, so guard with a findFirst rather than a null-keyed upsert.
  const existing = await prisma.roleAssignment.findFirst({
    where: {
      userId: user.id,
      roleId: superAdminRole.id,
      scopeType: ScopeType.GLOBAL,
      facultyId: null,
      departmentId: null,
      programmeId: null,
    },
  });
  if (!existing) {
    await prisma.roleAssignment.create({
      data: { userId: user.id, roleId: superAdminRole.id, scopeType: ScopeType.GLOBAL },
    });
  }
  console.log(`  bootstrap admin: ${email} (must change password on first login)`);
}

// --- Demo -------------------------------------------------------------------

interface DemoProgramme {
  id: string;
  code: string;
  facultyId: string;
  departmentId: string;
  departmentCode: string;
}

/** A small, clearly-labelled demo university structure. Returns programme refs. */
async function seedDemoStructure(): Promise<{ programmes: DemoProgramme[]; sessionId: string }> {
  const university = await prisma.university.upsert({
    where: { code: 'DEMO' },
    create: { name: 'Demo University', shortName: 'DEMO-U', code: 'DEMO' },
    update: { name: 'Demo University', shortName: 'DEMO-U' },
  });

  await prisma.campus.upsert({
    where: { universityId_code: { universityId: university.id, code: 'MAIN' } },
    create: { universityId: university.id, name: 'Main Campus', code: 'MAIN' },
    update: { name: 'Main Campus' },
  });

  const session = await prisma.academicSession.upsert({
    where: { name: '2024/2025' },
    create: {
      name: '2024/2025',
      startDate: new Date('2024-09-01'),
      endDate: new Date('2025-08-31'),
      isCurrent: true,
    },
    update: { isCurrent: true },
  });

  // faculty → departments → programmes, all idempotent on their natural uniques.
  const blueprint = [
    {
      faculty: { code: 'SCI', name: 'Faculty of Science' },
      departments: [
        {
          code: 'CSC',
          name: 'Department of Computer Science',
          programmes: [
            { code: 'CSC-BSC', name: 'B.Sc. Computer Science', award: 'B.Sc.', durationYears: 4 },
          ],
        },
        {
          code: 'MTH',
          name: 'Department of Mathematics',
          programmes: [
            { code: 'MTH-BSC', name: 'B.Sc. Mathematics', award: 'B.Sc.', durationYears: 4 },
          ],
        },
      ],
    },
    {
      faculty: { code: 'ENG', name: 'Faculty of Engineering' },
      departments: [
        {
          code: 'EEE',
          name: 'Department of Electrical Engineering',
          programmes: [
            {
              code: 'EEE-BENG',
              name: 'B.Eng. Electrical Engineering',
              award: 'B.Eng.',
              durationYears: 5,
            },
          ],
        },
      ],
    },
  ];

  const programmes: DemoProgramme[] = [];
  for (const f of blueprint) {
    const faculty = await prisma.faculty.upsert({
      where: { universityId_code: { universityId: university.id, code: f.faculty.code } },
      create: { universityId: university.id, name: f.faculty.name, code: f.faculty.code },
      update: { name: f.faculty.name },
    });
    for (const d of f.departments) {
      const department = await prisma.department.upsert({
        where: { facultyId_code: { facultyId: faculty.id, code: d.code } },
        create: { facultyId: faculty.id, name: d.name, code: d.code },
        update: { name: d.name },
      });
      for (const p of d.programmes) {
        const programme = await prisma.programme.upsert({
          where: { departmentId_code: { departmentId: department.id, code: p.code } },
          create: {
            departmentId: department.id,
            name: p.name,
            code: p.code,
            award: p.award,
            durationYears: p.durationYears,
          },
          update: { name: p.name, award: p.award, durationYears: p.durationYears },
        });
        programmes.push({
          id: programme.id,
          code: programme.code,
          facultyId: faculty.id,
          departmentId: department.id,
          departmentCode: department.code,
        });
      }
    }
  }
  console.log(`  demo structure: ${programmes.length} programme(s) under Demo University`);
  return { programmes, sessionId: session.id };
}

/**
 * A handful of PENDING demo student master records so activation + dashboards
 * are testable. Demo ids use a reserved STU<year>9xxxxx block so they never
 * collide with sequence-allocated real ids. Identity factors (surname + DOB) and
 * the on-file email are known, matching the activation challenge.
 */
async function seedDemoStudents(
  programmes: DemoProgramme[],
  sessionId: string,
  activeStatusId: string,
): Promise<void> {
  if (!programmes.length || !activeStatusId) return;

  const demo = [
    {
      matriculationNumber: 'CSC/2024/001',
      surname: 'Adeyemi',
      firstName: 'Bola',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('2005-03-14'),
      officialEmail: 'bola.adeyemi@demo.example',
    },
    {
      matriculationNumber: 'CSC/2024/002',
      surname: 'Okoro',
      firstName: 'Chidi',
      gender: Gender.MALE,
      dateOfBirth: new Date('2004-11-02'),
      officialEmail: 'chidi.okoro@demo.example',
    },
    {
      matriculationNumber: 'MTH/2024/003',
      surname: 'Ibrahim',
      firstName: 'Amina',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('2005-07-21'),
      officialEmail: 'amina.ibrahim@demo.example',
    },
    {
      matriculationNumber: 'EEE/2024/004',
      surname: 'Balogun',
      firstName: 'Tunde',
      gender: Gender.MALE,
      dateOfBirth: new Date('2003-12-09'),
      officialEmail: 'tunde.balogun@demo.example',
    },
  ];

  let created = 0;
  for (let i = 0; i < demo.length; i++) {
    const d = demo[i];
    const programme = programmes[i % programmes.length];
    const studentId = `STU2024${(900001 + i).toString().padStart(6, '0')}`;

    const data: Prisma.StudentRecordCreateInput = {
      studentId,
      matriculationNumber: d.matriculationNumber,
      surname: d.surname,
      firstName: d.firstName,
      gender: d.gender,
      dateOfBirth: d.dateOfBirth,
      currentLevel: 100,
      entryMode: EntryMode.UTME,
      activationState: ActivationState.PENDING,
      officialEmail: d.officialEmail,
      faculty: { connect: { id: programme.facultyId } },
      department: { connect: { id: programme.departmentId } },
      programme: { connect: { id: programme.id } },
      admissionSession: { connect: { id: sessionId } },
      studentStatus: { connect: { id: activeStatusId } },
    };

    // Idempotent create-if-absent (matric is the natural key).
    const existing = await prisma.studentRecord.findUnique({
      where: { matriculationNumber: d.matriculationNumber },
      select: { id: true },
    });
    if (!existing) {
      await prisma.studentRecord.create({ data });
      created++;
    }
  }
  console.log(
    `  demo students: ${created} created, ${demo.length - created} already present (all PENDING until activated)`,
  );
  console.log('  demo activation (http://localhost:3000/activate), then student sign-in:');
  for (const d of demo) {
    const dob = d.dateOfBirth.toISOString().slice(0, 10);
    console.log(
      `    ${d.matriculationNumber}  surname=${d.surname}  DOB=${dob}  (initial password = surname)`,
    );
  }
}

/**
 * A worked academic example for the demo session: two semesters, a small course
 * catalogue with a prerequisite chain, a PUBLISHED curriculum for the Computer
 * Science programme, and first-semester offerings.
 *
 * The curriculum deliberately totals exactly 15 units per level-100 semester,
 * matching the seeded credit-policy minimum, so registration has something
 * coherent to validate against when that module lands. MTH courses are owned by
 * Mathematics but required by Computer Science, which is the cross-department
 * case the offering and scope rules exist for.
 */
async function seedDemoAcademics(programmes: DemoProgramme[], sessionId: string): Promise<void> {
  const csc = programmes.find((p) => p.code === 'CSC-BSC');
  if (!csc) return;

  // --- Semesters. At most one may be current per session (guards.sql), so only
  // the first carries the flag.
  const semesterSpecs = [
    {
      sequence: 1,
      name: 'First Semester',
      startDate: new Date('2024-09-16'),
      endDate: new Date('2025-01-31'),
      isCurrent: true,
    },
    {
      sequence: 2,
      name: 'Second Semester',
      startDate: new Date('2025-02-17'),
      endDate: new Date('2025-07-25'),
      isCurrent: false,
    },
  ];
  const semesters = new Map<number, string>();
  for (const s of semesterSpecs) {
    const row = await prisma.semester.upsert({
      where: { sessionId_sequence: { sessionId, sequence: s.sequence } },
      create: { ...s, sessionId },
      update: { name: s.name, startDate: s.startDate, endDate: s.endDate },
    });
    semesters.set(s.sequence, row.id);
  }

  const categoryIds = new Map<string, string>();
  for (const key of ['CORE', 'GST']) {
    const c = await prisma.courseCategory.findUnique({ where: { key }, select: { id: true } });
    if (c) categoryIds.set(key, c.id);
  }
  const deptId = (code: string) => programmes.find((p) => p.departmentCode === code)?.departmentId;

  // --- Course catalogue. A null department means university-wide (the GST set).
  const courseSpecs = [
    {
      code: 'GST101',
      title: 'Use of English I',
      creditUnits: 2,
      level: 100,
      cat: 'GST',
      dept: null,
    },
    {
      code: 'GST102',
      title: 'Use of English II',
      creditUnits: 2,
      level: 100,
      cat: 'GST',
      dept: null,
    },
    {
      code: 'GST105',
      title: 'Use of Library, Study Skills and ICT',
      creditUnits: 1,
      level: 100,
      cat: 'GST',
      dept: null,
    },
    {
      code: 'GST107',
      title: 'History and Philosophy of Science',
      creditUnits: 1,
      level: 100,
      cat: 'GST',
      dept: null,
    },
    {
      code: 'CSC101',
      title: 'Introduction to Computer Science',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'CSC',
    },
    {
      code: 'CSC102',
      title: 'Introduction to Programming',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'CSC',
    },
    {
      code: 'CSC103',
      title: 'Problem Solving with Computers',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'CSC',
    },
    {
      code: 'CSC104',
      title: 'Introduction to Digital Systems',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'CSC',
    },
    {
      code: 'CSC201',
      title: 'Data Structures and Algorithms',
      creditUnits: 3,
      level: 200,
      cat: 'CORE',
      dept: 'CSC',
    },
    {
      code: 'MTH101',
      title: 'Elementary Mathematics I (Algebra and Trigonometry)',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'MTH',
    },
    {
      code: 'MTH102',
      title: 'Elementary Mathematics II (Calculus)',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'MTH',
    },
    {
      code: 'MTH103',
      title: 'Elementary Mathematics III (Vectors and Geometry)',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'MTH',
    },
    {
      code: 'MTH104',
      title: 'Elementary Mathematics IV (Statistics)',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'MTH',
    },
    {
      code: 'EEE101',
      title: 'Basic Electrical Engineering',
      creditUnits: 3,
      level: 100,
      cat: 'CORE',
      dept: 'EEE',
    },
  ];

  const courseIds = new Map<string, string>();
  for (const c of courseSpecs) {
    const row = await prisma.course.upsert({
      where: { code: c.code },
      create: {
        code: c.code,
        title: c.title,
        creditUnits: c.creditUnits,
        level: c.level,
        categoryId: categoryIds.get(c.cat) ?? null,
        departmentId: c.dept ? (deptId(c.dept) ?? null) : null,
      },
      // isActive is left alone — a course an institution deactivated stays so.
      update: { title: c.title, creditUnits: c.creditUnits, level: c.level },
    });
    courseIds.set(c.code, row.id);
  }

  // --- Prerequisites: you cannot take the second course without the first.
  const prereqs = [
    { course: 'CSC201', requires: 'CSC102' },
    { course: 'CSC102', requires: 'CSC101' },
    { course: 'MTH102', requires: 'MTH101' },
  ];
  for (const p of prereqs) {
    const courseId = courseIds.get(p.course);
    const prerequisiteCourseId = courseIds.get(p.requires);
    if (!courseId || !prerequisiteCourseId) continue;
    await prisma.coursePrerequisite.upsert({
      where: { courseId_prerequisiteCourseId: { courseId, prerequisiteCourseId } },
      create: { courseId, prerequisiteCourseId },
      update: {},
    });
  }

  // --- Curriculum. Published, because only a published version can drive
  // offerings and the demo needs offerings to exist.
  const requirementSpecs = [
    { code: 'CSC101', level: 100, semesterSequence: 1 },
    { code: 'CSC103', level: 100, semesterSequence: 1 },
    { code: 'MTH101', level: 100, semesterSequence: 1 },
    { code: 'MTH103', level: 100, semesterSequence: 1 },
    { code: 'GST101', level: 100, semesterSequence: 1 },
    { code: 'GST105', level: 100, semesterSequence: 1 },
    { code: 'CSC102', level: 100, semesterSequence: 2 },
    { code: 'CSC104', level: 100, semesterSequence: 2 },
    { code: 'MTH102', level: 100, semesterSequence: 2 },
    { code: 'MTH104', level: 100, semesterSequence: 2 },
    { code: 'GST102', level: 100, semesterSequence: 2 },
    { code: 'GST107', level: 100, semesterSequence: 2 },
    { code: 'CSC201', level: 200, semesterSequence: 1 },
  ];

  const version = await prisma.curriculumVersion.upsert({
    where: {
      programmeId_effectiveFromSessionId: {
        programmeId: csc.id,
        effectiveFromSessionId: sessionId,
      },
    },
    create: {
      programmeId: csc.id,
      effectiveFromSessionId: sessionId,
      name: 'B.Sc. Computer Science — 2024/2025',
      status: CurriculumStatus.PUBLISHED,
      publishedAt: new Date(),
      notes: 'Demo curriculum. 15 units per level-100 semester.',
    },
    // Status is not forced on re-run: a version an administrator archived must
    // stay archived, and a published one is frozen (INV-7) either way.
    update: { name: 'B.Sc. Computer Science — 2024/2025' },
  });

  for (const r of requirementSpecs) {
    const courseId = courseIds.get(r.code);
    if (!courseId) continue;
    await prisma.curriculumRequirement.upsert({
      where: {
        curriculumVersionId_courseId: { curriculumVersionId: version.id, courseId },
      },
      create: {
        curriculumVersionId: version.id,
        courseId,
        level: r.level,
        semesterSequence: r.semesterSequence,
        requirementType: RequirementType.COMPULSORY,
      },
      update: { level: r.level, semesterSequence: r.semesterSequence },
    });
  }

  // --- Offerings for the current (first) semester, OPEN so they are visible to
  // students. The teaching department is the one that OWNS the course: MTH101 is
  // taught by Mathematics even though this curriculum belongs to Computer
  // Science, and the GST courses are university-wide, owned by nobody.
  const firstSemesterId = semesters.get(1);
  let offerings = 0;
  if (firstSemesterId) {
    for (const r of requirementSpecs.filter((x) => x.semesterSequence === 1)) {
      const courseId = courseIds.get(r.code);
      if (!courseId) continue;
      const spec = courseSpecs.find((c) => c.code === r.code);
      await prisma.courseOffering.upsert({
        where: {
          courseId_sessionId_semesterId: { courseId, sessionId, semesterId: firstSemesterId },
        },
        create: {
          courseId,
          sessionId,
          semesterId: firstSemesterId,
          departmentId: spec?.dept ? (deptId(spec.dept) ?? null) : null,
          status: OfferingStatus.OPEN,
          capacity: 120,
        },
        // Capacity and status are left alone on re-run: seatsTaken belongs to
        // registration, and overwriting either could strand registered students.
        update: {},
      });
      offerings++;
    }
  }

  console.log(
    `  demo academics: ${semesterSpecs.length} semester(s), ${courseSpecs.length} course(s), ` +
      `${prereqs.length} prerequisite(s), ${requirementSpecs.length} requirement(s), ` +
      `${offerings} offering(s)`,
  );
}

// --- Orchestration ----------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding ePortal…');

  console.log('- foundational');
  const permIdByKey = await seedPermissions();
  await seedRoles(permIdByKey);
  const activeStatusId = await seedStudentStatuses();
  await seedCourseCategories();
  await seedGradeScale();
  await seedCreditPolicy();
  await seedRegistrationApprovalChain();
  await seedResultApprovalChain();
  await seedBootstrapAdmin();

  if (seedDemo()) {
    console.log('- demo (SEED_DEMO active)');
    const { programmes, sessionId } = await seedDemoStructure();
    await seedDemoStudents(programmes, sessionId, activeStatusId);
    await seedDemoAcademics(programmes, sessionId);
  } else {
    console.log('- demo: SKIPPED (production or SEED_DEMO=false)');
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
