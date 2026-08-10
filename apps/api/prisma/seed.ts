/**
 * Database seed (idempotent). Run AFTER `prisma migrate` and `guards.sql`:
 *
 *   npm run prisma:deploy && psql "$DATABASE_ADMIN_URL" -f prisma/guards.sql && npm run seed
 *
 * What it writes:
 *   • FOUNDATIONAL (always): the permission catalog, the system roles + their
 *     role→permission links, the student-status vocabulary, and ONE bootstrap
 *     SUPER_ADMIN read from BOOTSTRAP_ADMIN_* env (never hardcoded).
 *   • DEMO (gated by SEED_DEMO): a small university structure and a handful of
 *     PENDING demo student master records for exercising activation/dashboards.
 *     Demo data is skipped in production unless SEED_DEMO=true is set explicitly,
 *     so no fake data can slip into a real deployment.
 *
 * Every write is an upsert keyed on a natural unique, so re-running is safe.
 *
 * NOTE: no "grade scale" is seeded — Phase 1 has no results/GPA model in the
 * schema, so seeding one would be inventing structure the system cannot use.
 * That belongs to the Phase 2 academic-records work.
 */
import {
  ActivationState,
  EntryMode,
  Gender,
  Prisma,
  PrismaClient,
  ScopeType,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { PERMISSION_DEFS } from '../src/rbac/permissions.catalog';
import { ROLE_DEFS } from '../src/rbac/roles.catalog';

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
  facultyId: string;
  departmentId: string;
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
          facultyId: faculty.id,
          departmentId: department.id,
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
      matriculationNumber: 'DEMO/CSC/24/0001',
      surname: 'Adeyemi',
      firstName: 'Bola',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('2005-03-14'),
      officialEmail: 'bola.adeyemi@demo.example',
    },
    {
      matriculationNumber: 'DEMO/CSC/24/0002',
      surname: 'Okoro',
      firstName: 'Chidi',
      gender: Gender.MALE,
      dateOfBirth: new Date('2004-11-02'),
      officialEmail: 'chidi.okoro@demo.example',
    },
    {
      matriculationNumber: 'DEMO/MTH/24/0003',
      surname: 'Ibrahim',
      firstName: 'Amina',
      gender: Gender.FEMALE,
      dateOfBirth: new Date('2005-07-21'),
      officialEmail: 'amina.ibrahim@demo.example',
    },
    {
      matriculationNumber: 'DEMO/EEE/24/0004',
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
    `  demo students: ${created} created, ${demo.length - created} already present (all PENDING)`,
  );
}

// --- Orchestration ----------------------------------------------------------

async function main(): Promise<void> {
  console.log('Seeding ePortal…');

  console.log('- foundational');
  const permIdByKey = await seedPermissions();
  await seedRoles(permIdByKey);
  const activeStatusId = await seedStudentStatuses();
  await seedBootstrapAdmin();

  if (seedDemo()) {
    console.log('- demo (SEED_DEMO active)');
    const { programmes, sessionId } = await seedDemoStructure();
    await seedDemoStudents(programmes, sessionId, activeStatusId);
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
