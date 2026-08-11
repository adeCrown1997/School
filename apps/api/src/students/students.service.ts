import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StructureService } from '../structure/structure.service';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { assertWithinScope, scopeConstraintFor, studentScopeWhere } from '../rbac/scope.util';
import { generateToken } from '../common/crypto.util';
import { Paginated, sortDirection } from '../common/pagination';
import { IdGeneratorService } from './id-generator.service';
import {
  MATRIC_FORMAT_MESSAGE,
  isValidMatriculationNumber,
  normalizeMatriculationNumber,
} from './matriculation';
import {
  ChangeStudentStatusDto,
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from './dto/students.dto';

/** The set of protected identity columns — mirrors the DB trigger's list. Used
 *  to defend in depth: no service path may write these outside an amendment. */
export const PROTECTED_STUDENT_FIELDS = [
  'studentId',
  'matriculationNumber',
  'jambRegistrationNumber',
  'surname',
  'firstName',
  'otherNames',
  'dateOfBirth',
  'gender',
  'facultyId',
  'departmentId',
  'programmeId',
  'admissionSessionId',
  'entryMode',
  'currentLevel',
  'studentStatusId',
] as const;

/** Normalized shape for creating a master record — shared with bulk import. */
export interface StudentMasterInput {
  matriculationNumber: string;
  jambRegistrationNumber?: string | null;
  surname: string;
  firstName: string;
  otherNames?: string | null;
  dateOfBirth: Date;
  gender?: Prisma.StudentRecordCreateInput['gender'];
  facultyId: string;
  departmentId: string;
  programmeId: string;
  admissionSessionId: string;
  entryMode?: Prisma.StudentRecordCreateInput['entryMode'];
  currentLevel: number;
  studentStatusId?: string;
  /** Contact of record (NOT identity) — the OTP delivery channel + login email
   *  used at activation. Excluded from the protected-field trigger list. */
  officialEmail?: string | null;
  officialPhone?: string | null;
}

const STUDENT_INCLUDE = {
  faculty: { select: { id: true, name: true, code: true } },
  department: { select: { id: true, name: true, code: true } },
  programme: { select: { id: true, name: true, code: true, durationYears: true } },
  admissionSession: { select: { id: true, name: true } },
  studentStatus: { select: { id: true, key: true, label: true, allowsLogin: true } },
  userAccount: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
  profile: { select: { id: true } },
} satisfies Prisma.StudentRecordInclude;

/**
 * Official student master-record service — the SOURCE OF TRUTH for student
 * identity (INV: the university owns identity; students never self-create it).
 *
 * Enforcement layers embodied here:
 *   L3 (service): creation is admin-only and accepts identity fields ONLY from
 *   an authorized actor; every UPDATE path physically restricts itself to
 *   non-protected fields, and the ONLY way protected fields change is
 *   applyProtectedAmendment(), which routes through the SECURITY DEFINER
 *   amendment function (PrismaService.amendStudentRecord). No login account is
 *   ever created here — activation is a separate, student-driven flow against a
 *   PRE-EXISTING record.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly structure: StructureService,
    private readonly idGen: IdGeneratorService,
  ) {}

  // --- Create -------------------------------------------------------------
  async create(dto: CreateStudentDto, actor: AuthPrincipal) {
    // Authority: the actor must be allowed to create within the target scope.
    const scope = scopeConstraintFor(actor, PERMISSIONS.STUDENTS_CREATE);
    assertWithinScope(scope, {
      facultyId: dto.facultyId,
      departmentId: dto.departmentId,
      programmeId: dto.programmeId,
    });

    const input = await this.normalizeAndValidate(dto);
    const record = await this.insertRecord(input, actor);

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'student.create',
      entityType: 'StudentRecord',
      entityId: record.id,
      after: {
        studentId: record.studentId,
        matriculationNumber: record.matriculationNumber,
        facultyId: record.facultyId,
        departmentId: record.departmentId,
        programmeId: record.programmeId,
        activationState: record.activationState,
      },
    });

    return this.getById(record.id, actor);
  }

  /**
   * Insert a single master record inside its own transaction. Shared by the
   * create endpoint and the bulk-import module. Generates the internal student
   * id from the admission-session year and starts life in PENDING activation —
   * NO User row is created (INV-1: creating a record never creates a login).
   * The matric unique index (case-insensitive) is the ultimate duplicate guard;
   * a race that slips past the pre-check surfaces as P2002 → ConflictException.
   */
  async insertRecord(input: StudentMasterInput, actor: AuthPrincipal) {
    const year = await this.admissionYear(input.admissionSessionId);
    try {
      return await this.prisma.$transaction((tx) => this.insertRecordTx(tx, input, actor, year));
    } catch (err) {
      throw this.translateWriteError(err, input.matriculationNumber);
    }
  }

  /**
   * Insert a master record using a CALLER-PROVIDED transaction, so the bulk
   * importer can commit many rows atomically (all-or-nothing) in a single tx —
   * Prisma cannot nest interactive transactions, so insertRecord() cannot be
   * reused inside another tx. `year` is precomputed by the caller (it needs the
   * session anyway). Does NOT translate errors — the caller decides per-row vs
   * whole-batch handling.
   */
  async insertRecordTx(
    tx: PrismaTx,
    input: StudentMasterInput,
    actor: AuthPrincipal,
    year: number,
  ) {
    await this.assertMatricAvailable(tx, input.matriculationNumber);
    const studentId = await this.idGen.nextStudentId(tx, year);
    return tx.studentRecord.create({
      data: {
        studentId,
        matriculationNumber: input.matriculationNumber,
        jambRegistrationNumber: input.jambRegistrationNumber ?? null,
        surname: input.surname,
        firstName: input.firstName,
        otherNames: input.otherNames ?? null,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender ?? 'UNSPECIFIED',
        facultyId: input.facultyId,
        departmentId: input.departmentId,
        programmeId: input.programmeId,
        admissionSessionId: input.admissionSessionId,
        entryMode: input.entryMode ?? 'UTME',
        currentLevel: input.currentLevel,
        studentStatusId: input.studentStatusId!,
        officialEmail: input.officialEmail ?? null,
        officialPhone: input.officialPhone ?? null,
        activationState: 'PENDING',
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  }

  /** Public helper so the importer can compute the id year without re-querying. */
  async resolveAdmissionYear(sessionId: string): Promise<number> {
    return this.admissionYear(sessionId);
  }

  /**
   * Validate + normalize a raw create DTO into a StudentMasterInput. Reused (via
   * validateMasterInput) so the import module applies the SAME rules row-by-row.
   */
  private async normalizeAndValidate(dto: CreateStudentDto): Promise<StudentMasterInput> {
    return this.validateMasterInput({
      matriculationNumber: normalizeMatriculationNumber(dto.matriculationNumber),
      jambRegistrationNumber: dto.jambRegistrationNumber?.trim() || null,
      surname: dto.surname.trim(),
      firstName: dto.firstName.trim(),
      otherNames: dto.otherNames?.trim() || null,
      dateOfBirth: new Date(dto.dateOfBirth),
      gender: dto.gender,
      facultyId: dto.facultyId,
      departmentId: dto.departmentId,
      programmeId: dto.programmeId,
      admissionSessionId: dto.admissionSessionId,
      entryMode: dto.entryMode,
      currentLevel: dto.currentLevel,
      studentStatusId: dto.studentStatusId,
      officialEmail: dto.officialEmail?.trim().toLowerCase() || null,
      officialPhone: dto.officialPhone?.trim() || null,
    });
  }

  /**
   * Cross-field validation shared by single create AND bulk import. Confirms the
   * academic hierarchy is internally consistent, the session exists, the level
   * is plausible for the programme, and resolves a default ACTIVE status when
   * none was supplied. Throws BadRequestException with a precise message on the
   * first problem — import surfaces these as row-level errors.
   */
  async validateMasterInput(input: StudentMasterInput): Promise<StudentMasterInput> {
    // Matric format is checked HERE, not only in the DTO, because bulk import
    // builds a StudentMasterInput directly and never passes through CreateStudentDto.
    // Normalizing first makes the canonical (upper-case) form what gets stored,
    // which is what the case-insensitive unique index expects.
    input.matriculationNumber = normalizeMatriculationNumber(input.matriculationNumber);
    if (!isValidMatriculationNumber(input.matriculationNumber)) {
      throw new BadRequestException(MATRIC_FORMAT_MESSAGE);
    }

    if (Number.isNaN(input.dateOfBirth.getTime())) {
      throw new BadRequestException('Invalid date of birth');
    }
    if (input.dateOfBirth.getTime() > Date.now()) {
      throw new BadRequestException('Date of birth cannot be in the future');
    }
    if (input.currentLevel % 100 !== 0) {
      throw new BadRequestException('Level must be a multiple of 100 (e.g. 100, 200)');
    }

    const programme = await this.structure.assertAcademicHierarchy(
      input.facultyId,
      input.departmentId,
      input.programmeId,
    );

    // A student cannot plausibly be beyond duration + 2 grace levels.
    const maxLevel = (programme.durationYears + 2) * 100;
    if (input.currentLevel > maxLevel) {
      throw new BadRequestException(
        `Level ${input.currentLevel} exceeds the maximum for this programme`,
      );
    }

    const session = await this.prisma.academicSession.findUnique({
      where: { id: input.admissionSessionId },
    });
    if (!session) throw new BadRequestException('Invalid admission session');

    input.studentStatusId = await this.resolveStatusId(input.studentStatusId);
    return input;
  }

  /** Resolve an explicit status id, or fall back to the seeded ACTIVE status. */
  private async resolveStatusId(statusId?: string): Promise<string> {
    if (statusId) {
      const status = await this.prisma.studentStatus.findUnique({ where: { id: statusId } });
      if (!status) throw new BadRequestException('Invalid student status');
      return status.id;
    }
    const active = await this.prisma.studentStatus.findUnique({ where: { key: 'ACTIVE' } });
    if (!active) {
      throw new BadRequestException(
        'No default student status configured — seed student statuses first',
      );
    }
    return active.id;
  }

  private async admissionYear(sessionId: string): Promise<number> {
    const session = await this.prisma.academicSession.findUnique({ where: { id: sessionId } });
    // name looks like "2024/2025"; fall back to the start year, then now.
    const fromName = session?.name?.slice(0, 4);
    const year = fromName && /^\d{4}$/.test(fromName) ? Number(fromName) : undefined;
    return year ?? session?.startDate.getUTCFullYear() ?? new Date().getUTCFullYear();
  }

  /** Case-insensitive pre-check for a friendly duplicate error (DB index is the
   *  authoritative guarantee). */
  async assertMatricAvailable(client: PrismaTx | PrismaService, matric: string): Promise<void> {
    const existing = await client.studentRecord.findFirst({
      where: { matriculationNumber: { equals: matric, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A student with this matriculation number already exists');
    }
  }

  /**
   * Soft duplicate heuristic for import preview: same surname + first name +
   * date of birth may indicate a re-import. Not a hard block (names collide);
   * surfaced as a warning so the operator decides.
   */
  async findLikelyDuplicate(input: StudentMasterInput): Promise<string | null> {
    const match = await this.prisma.studentRecord.findFirst({
      where: {
        surname: { equals: input.surname, mode: 'insensitive' },
        firstName: { equals: input.firstName, mode: 'insensitive' },
        dateOfBirth: input.dateOfBirth,
      },
      select: { matriculationNumber: true },
    });
    return match?.matriculationNumber ?? null;
  }

  // --- Read ---------------------------------------------------------------
  async list(query: ListStudentsQueryDto, actor: AuthPrincipal): Promise<Paginated<unknown>> {
    const scope = scopeConstraintFor(actor, PERMISSIONS.STUDENTS_VIEW);
    const scopeWhere = studentScopeWhere(scope);

    const filters: Prisma.StudentRecordWhereInput = {};
    if (query.facultyId) filters.facultyId = query.facultyId;
    if (query.departmentId) filters.departmentId = query.departmentId;
    if (query.programmeId) filters.programmeId = query.programmeId;
    if (query.admissionSessionId) filters.admissionSessionId = query.admissionSessionId;
    if (query.studentStatusId) filters.studentStatusId = query.studentStatusId;
    if (query.activationState) filters.activationState = query.activationState;
    if (query.level) filters.currentLevel = query.level;

    if (query.search) {
      const s = query.search.trim();
      filters.OR = [
        { matriculationNumber: { contains: s, mode: 'insensitive' } },
        { studentId: { contains: s, mode: 'insensitive' } },
        { surname: { contains: s, mode: 'insensitive' } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { jambRegistrationNumber: { contains: s, mode: 'insensitive' } },
      ];
    }

    const where: Prisma.StudentRecordWhereInput = scopeWhere
      ? { AND: [scopeWhere as Prisma.StudentRecordWhereInput, filters] }
      : filters;

    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.studentRecord.findMany({
        where,
        include: STUDENT_INCLUDE,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.studentRecord.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private buildOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
  ): Prisma.StudentRecordOrderByWithRelationInput {
    const dir = sortDirection(sortDir);
    const allowed: Record<string, Prisma.StudentRecordOrderByWithRelationInput> = {
      surname: { surname: dir },
      matriculationNumber: { matriculationNumber: dir },
      currentLevel: { currentLevel: dir },
      createdAt: { createdAt: dir },
    };
    return allowed[sortBy ?? ''] ?? { createdAt: 'desc' };
  }

  /**
   * The configurable student-status vocabulary (Active, Deferred, Suspended, …).
   * Read-only reference data so the admin status-change UI is driven by the DB,
   * never a hardcoded frontend list (§18). Ordered for stable display.
   */
  async listStatuses() {
    return this.prisma.studentStatus.findMany({
      select: { id: true, key: true, label: true, allowsLogin: true },
      orderBy: { label: 'asc' },
    });
  }

  async getById(id: string, actor: AuthPrincipal) {
    const record = await this.prisma.studentRecord.findUnique({
      where: { id },
      include: STUDENT_INCLUDE,
    });
    if (!record) throw new NotFoundException('Student record not found');

    const scope = scopeConstraintFor(actor, PERMISSIONS.STUDENTS_VIEW);
    assertWithinScope(scope, {
      facultyId: record.facultyId,
      departmentId: record.departmentId,
      programmeId: record.programmeId,
    });
    return record;
  }

  // --- Update (non-protected only) ---------------------------------------
  async updateNonProtected(id: string, dto: UpdateStudentDto, actor: AuthPrincipal) {
    const record = await this.getById(id, actor); // scope-checked
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.STUDENTS_UPDATE), {
      facultyId: record.facultyId,
      departmentId: record.departmentId,
      programmeId: record.programmeId,
    });

    // Only non-protected fields are expressible; this write never trips the DB
    // trigger because no protected column changes.
    const updated = await this.prisma.studentRecord.update({
      where: { id },
      data: { photoKey: dto.photoKey ?? record.photoKey, updatedById: actor.userId },
      include: STUDENT_INCLUDE,
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'student.update',
      entityType: 'StudentRecord',
      entityId: id,
      before: { photoKey: record.photoKey },
      after: { photoKey: updated.photoKey },
    });
    return updated;
  }

  // --- Status change (an approved amendment) -----------------------------
  async changeStatus(id: string, dto: ChangeStudentStatusDto, actor: AuthPrincipal) {
    const record = await this.getById(id, actor); // scope-checked (view)
    assertWithinScope(scopeConstraintFor(actor, PERMISSIONS.STUDENTS_STATUS), {
      facultyId: record.facultyId,
      departmentId: record.departmentId,
      programmeId: record.programmeId,
    });

    const status = await this.prisma.studentStatus.findUnique({
      where: { id: dto.studentStatusId },
    });
    if (!status) throw new BadRequestException('Invalid student status');
    if (status.id === record.studentStatusId) {
      throw new BadRequestException('Student already has this status');
    }

    return this.applyProtectedAmendment(
      id,
      { studentStatusId: status.id },
      { action: 'student.status.change', reason: dto.reason },
      actor,
    );
  }

  /**
   * THE ONLY path that mutates protected identity columns. Delegates the actual
   * write to PrismaService.amendStudentRecord(), which calls the SECURITY
   * DEFINER function that (a) sets the transaction-local `eportal.amendment_id`
   * GUC the DB trigger requires and (b) whitelists the touched columns. The app
   * DB role has no direct UPDATE grant on protected columns, so any protected
   * write NOT routed through here is rejected by the database itself. The
   * amendment is audited transactionally (before/after + correlation id), so the
   * change and its justification commit atomically or not at all.
   *
   * Exposed for reuse by the change-request approval workflow (Registry applies
   * an approved correction). `changes` may only contain protected fields; a
   * guard rejects anything else defensively.
   */
  async applyProtectedAmendment(
    recordId: string,
    changes: Partial<Record<(typeof PROTECTED_STUDENT_FIELDS)[number], unknown>>,
    context: { action: string; reason?: string; amendmentId?: string; changeRequestId?: string },
    actor: AuthPrincipal,
    withinTx?: (tx: PrismaTx) => Promise<void>,
  ) {
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new BadRequestException('No changes supplied');
    const illegal = keys.filter(
      (k) => !PROTECTED_STUDENT_FIELDS.includes(k as (typeof PROTECTED_STUDENT_FIELDS)[number]),
    );
    if (illegal.length > 0) {
      throw new BadRequestException(`Not amendable via this path: ${illegal.join(', ')}`);
    }
    // studentId + matriculationNumber are immutable by policy in Phase 1 (they
    // are also absent from the DB function's whitelist — defense in depth).
    if (keys.includes('studentId') || keys.includes('matriculationNumber')) {
      throw new BadRequestException('This identifier cannot be amended');
    }

    const amendmentId = context.amendmentId ?? context.changeRequestId ?? generateToken(16);

    const before = await this.prisma.studentRecord.findUnique({
      where: { id: recordId },
      select: this.selectionFor(keys),
    });
    if (!before) throw new NotFoundException('Student record not found');

    const changesSnake = this.toSnakeChanges(changes);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.prisma.amendStudentRecord(tx, recordId, changesSnake, amendmentId, actor.userId);
      const row = await tx.studentRecord.findUnique({
        where: { id: recordId },
        include: STUDENT_INCLUDE,
      });
      await this.audit.recordTx(tx, {
        actorId: actor.userId,
        actorLabel: actor.email,
        action: context.action,
        entityType: 'StudentRecord',
        entityId: recordId,
        // Narrowed through `pick` for the same reason as `after`: the dynamic
        // select widens the inferred type to include relation payloads, and only
        // the amended scalar fields belong in the audit entry.
        before: this.pick(before as Record<string, unknown>, keys) as Prisma.InputJsonValue,
        after: this.pick(row as Record<string, unknown>, keys) as Prisma.InputJsonValue,
        metadata: {
          amendmentId,
          reason: context.reason ?? null,
          changeRequestId: context.changeRequestId ?? null,
        },
      });
      // Optional caller-supplied work that MUST commit atomically with the
      // amendment (e.g. marking the originating change request APPROVED). If it
      // throws, the whole amendment rolls back.
      if (withinTx) await withinTx(tx);
      return row;
    });
    return updated;
  }

  /** Map camelCase protected keys → the snake_case columns the DB function
   *  whitelists, serializing values (Date → YYYY-MM-DD) for JSONB transport. */
  private toSnakeChanges(
    changes: Partial<Record<(typeof PROTECTED_STUDENT_FIELDS)[number], unknown>>,
  ): Record<string, unknown> {
    const MAP: Record<string, string> = {
      jambRegistrationNumber: 'jamb_registration_number',
      surname: 'surname',
      firstName: 'first_name',
      otherNames: 'other_names',
      dateOfBirth: 'date_of_birth',
      gender: 'gender',
      facultyId: 'faculty_id',
      departmentId: 'department_id',
      programmeId: 'programme_id',
      admissionSessionId: 'admission_session_id',
      entryMode: 'entry_mode',
      currentLevel: 'current_level',
      studentStatusId: 'student_status_id',
    };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) {
      const col = MAP[k];
      if (!col) continue; // studentId/matriculationNumber already rejected above
      out[col] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }
    return out;
  }

  /** Build a Prisma select object for the given field keys. */
  private selectionFor(keys: string[]): Prisma.StudentRecordSelect {
    const sel: Record<string, boolean> = {};
    for (const k of keys) sel[k] = true;
    return sel as Prisma.StudentRecordSelect;
  }

  private pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = obj[k];
    return out;
  }

  private translateWriteError(err: unknown, matric: string): Error {
    if (err instanceof ConflictException || err instanceof BadRequestException) return err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException(
        `A student with matriculation number "${matric}" already exists`,
      );
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
