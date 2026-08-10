import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EntryMode, Gender } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AuthPrincipal } from '../../common/auth-principal';
import { sha256 } from '../../common/crypto.util';
import { PERMISSIONS } from '../../rbac/permissions.catalog';
import { assertWithinScope, ScopeConstraint, scopeConstraintFor } from '../../rbac/scope.util';
import { StudentMasterInput, StudentsService } from '../students.service';
import { ImportColumn, parseImportFile, RawRow } from './import-parse.util';
import { ImportCommitDto } from './dto/import.dto';

/** One row's outcome in preview/commit — errors are ALWAYS reported, never dropped. */
export interface RowReport {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  matriculationNumber?: string;
  fullName?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportSummary {
  totalRows: number;
  valid: number;
  warnings: number;
  errors: number;
  previewToken: string;
  unknownHeaders: string[];
  rows: RowReport[];
}

interface ResolvedRow {
  rowNumber: number;
  input: StudentMasterInput;
  report: RowReport;
}

/** Prebuilt lookups so validation is in-memory, not N queries per row. */
interface Catalog {
  facultiesByCode: Map<string, { id: string }>;
  departmentsByKey: Map<string, { id: string; facultyId: string }>;
  programmesByKey: Map<
    string,
    { id: string; departmentId: string; facultyId: string; durationYears: number }
  >;
  sessionsByName: Map<string, { id: string }>;
  statusesByKey: Map<string, { id: string }>;
  defaultStatusId: string | null;
}

/**
 * Bulk student import (CSV/XLSX). Implements the full pipeline the spec
 * requires — Upload → Parse → Validate → Preview → Errors → Confirm → Import →
 * Summary → Audit — with strict guarantees:
 *   • Row-level errors are ALWAYS surfaced; invalid records are never silently
 *     discarded.
 *   • Preview performs NO writes.
 *   • Commit is all-or-nothing: if ANY row still has a hard error it aborts and
 *     reports, importing nothing (the operator fixes the file and retries).
 *   • Every imported record uses the SAME authoritative insert path as single
 *     create (system-generated id, matric uniqueness, PENDING activation, no
 *     login account), inside ONE transaction for atomicity.
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly students: StudentsService,
  ) {}

  /** Phase 1: validate only, return a per-row report. No database writes. */
  async preview(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    actor: AuthPrincipal,
    defaultAdmissionSessionId?: string,
  ): Promise<ImportSummary> {
    const { rows, unknownHeaders, previewToken } = await this.parse(file);
    const resolved = await this.resolveAll(rows, actor, defaultAdmissionSessionId);
    return this.summarize(resolved, unknownHeaders, previewToken);
  }

  /** Phase 2: re-validate the same file, then insert all valid rows atomically. */
  async commit(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    dto: ImportCommitDto,
    actor: AuthPrincipal,
  ): Promise<ImportSummary & { imported: number }> {
    const { rows, unknownHeaders, previewToken } = await this.parse(file);
    if (previewToken !== dto.previewToken) {
      throw new BadRequestException(
        'The file does not match the previewed file. Preview again before importing.',
      );
    }
    const resolved = await this.resolveAll(rows, actor, dto.defaultAdmissionSessionId);
    const summary = this.summarize(resolved, unknownHeaders, previewToken);

    // Never import while hard errors remain — report and abort (nothing written).
    if (summary.errors > 0) {
      throw new UnprocessableEntityException({
        message: 'Import aborted: the file still contains invalid rows. No records were imported.',
        summary,
      });
    }
    // Soft-duplicate warnings block unless the operator explicitly accepts them.
    if (summary.warnings > 0 && !dto.acceptWarnings) {
      throw new UnprocessableEntityException({
        message:
          'Import halted: possible duplicates detected. Re-submit with acceptWarnings=true to proceed.',
        summary,
      });
    }

    const importable = resolved.filter((r) => r.report.status !== 'error');
    const imported = await this.insertAll(importable, actor);

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'student.import',
      entityType: 'StudentRecord',
      metadata: {
        totalRows: summary.totalRows,
        imported,
        filename: file.originalname,
        previewToken,
      },
    });

    return { ...summary, imported };
  }

  // --- Internals ----------------------------------------------------------
  private async parse(file: { buffer: Buffer; originalname: string; mimetype: string }) {
    if (!file?.buffer?.length) throw new BadRequestException('No file uploaded');
    const parsed = await parseImportFile(file.buffer, file.originalname, file.mimetype);
    const previewToken = sha256(file.buffer.toString('base64'));
    return { ...parsed, previewToken };
  }

  private async insertAll(importable: ResolvedRow[], actor: AuthPrincipal): Promise<number> {
    if (importable.length === 0) return 0;
    // Precompute the id-year per row (needs the session) before opening the tx.
    const withYear = await Promise.all(
      importable.map(async (r) => ({
        input: r.input,
        year: await this.students.resolveAdmissionYear(r.input.admissionSessionId),
      })),
    );
    // ONE interactive transaction → true all-or-nothing.
    return this.prisma.$transaction(async (tx) => {
      let count = 0;
      for (const { input, year } of withYear) {
        await this.students.insertRecordTx(tx, input, actor, year);
        count++;
      }
      return count;
    });
  }

  private summarize(
    resolved: ResolvedRow[],
    unknownHeaders: string[],
    previewToken: string,
  ): ImportSummary {
    const rows = resolved.map((r) => r.report);
    return {
      totalRows: rows.length,
      valid: rows.filter((r) => r.status === 'valid').length,
      warnings: rows.filter((r) => r.status === 'warning').length,
      errors: rows.filter((r) => r.status === 'error').length,
      previewToken,
      unknownHeaders,
      rows,
    };
  }

  private async buildCatalog(): Promise<Catalog> {
    const [faculties, departments, programmes, sessions, statuses] = await Promise.all([
      this.prisma.faculty.findMany({ select: { id: true, code: true } }),
      this.prisma.department.findMany({ select: { id: true, code: true, facultyId: true } }),
      this.prisma.programme.findMany({
        select: {
          id: true,
          code: true,
          departmentId: true,
          durationYears: true,
          department: { select: { facultyId: true } },
        },
      }),
      this.prisma.academicSession.findMany({ select: { id: true, name: true } }),
      this.prisma.studentStatus.findMany({ select: { id: true, key: true } }),
    ]);

    const facultiesByCode = new Map(faculties.map((f) => [f.code.toLowerCase(), { id: f.id }]));
    const departmentsByKey = new Map(
      departments.map((d) => [
        `${d.facultyId}:${d.code.toLowerCase()}`,
        { id: d.id, facultyId: d.facultyId },
      ]),
    );
    const programmesByKey = new Map(
      programmes.map((p) => [
        `${p.departmentId}:${p.code.toLowerCase()}`,
        {
          id: p.id,
          departmentId: p.departmentId,
          facultyId: p.department.facultyId,
          durationYears: p.durationYears,
        },
      ]),
    );
    const sessionsByName = new Map(sessions.map((s) => [s.name, { id: s.id }]));
    const statusesByKey = new Map(statuses.map((s) => [s.key.toUpperCase(), { id: s.id }]));
    const defaultStatusId = statusesByKey.get('ACTIVE')?.id ?? null;

    return {
      facultiesByCode,
      departmentsByKey,
      programmesByKey,
      sessionsByName,
      statusesByKey,
      defaultStatusId,
    };
  }

  private async resolveAll(
    rows: RawRow[],
    actor: AuthPrincipal,
    defaultAdmissionSessionId?: string,
  ): Promise<ResolvedRow[]> {
    const catalog = await this.buildCatalog();
    const scope = scopeConstraintFor(actor, PERMISSIONS.STUDENTS_IMPORT);

    // Preload existing matrics for the whole file in one query (DB duplicates).
    const fileMatrics = rows
      .map((r) => r.values.matriculationNumber?.trim())
      .filter((m): m is string => !!m);
    const existing = fileMatrics.length
      ? await this.prisma.studentRecord.findMany({
          where: { matriculationNumber: { in: fileMatrics, mode: 'insensitive' } },
          select: { matriculationNumber: true },
        })
      : [];
    const existingLower = new Set(existing.map((e) => e.matriculationNumber.toLowerCase()));

    const seenInFile = new Set<string>();
    const resolved: ResolvedRow[] = [];

    for (const row of rows) {
      resolved.push(
        this.resolveRow(row, catalog, scope, existingLower, seenInFile, defaultAdmissionSessionId),
      );
    }

    await this.applySoftDuplicateWarnings(resolved);
    return resolved;
  }

  /**
   * Batched soft-duplicate detection: flag rows whose (surname, first name,
   * date of birth) already exists in the DB. This is a WARNING, not an error —
   * names legitimately collide — so the operator decides (acceptWarnings). One
   * query for the whole file (filtered by the surnames present), matched
   * precisely in memory.
   */
  private async applySoftDuplicateWarnings(resolved: ResolvedRow[]): Promise<void> {
    const candidates = resolved.filter(
      (r) => r.report.status !== 'error' && r.input.surname && r.input.firstName,
    );
    if (candidates.length === 0) return;

    const surnames = [...new Set(candidates.map((r) => r.input.surname))];
    const existing = await this.prisma.studentRecord.findMany({
      where: { surname: { in: surnames, mode: 'insensitive' } },
      select: { surname: true, firstName: true, dateOfBirth: true },
    });
    const key = (s: string, f: string, d: Date) =>
      `${s.toLowerCase()}|${f.toLowerCase()}|${d.toISOString().slice(0, 10)}`;
    const existingSet = new Set(existing.map((e) => key(e.surname, e.firstName, e.dateOfBirth)));

    for (const r of candidates) {
      if (existingSet.has(key(r.input.surname, r.input.firstName, r.input.dateOfBirth))) {
        r.report.warnings.push(
          'A student with the same name and date of birth already exists (possible duplicate)',
        );
        r.report.status = 'warning';
      }
    }
  }

  private resolveRow(
    row: RawRow,
    catalog: Catalog,
    scope: ScopeConstraint,
    existingLower: Set<string>,
    seenInFile: Set<string>,
    defaultAdmissionSessionId?: string,
  ): ResolvedRow {
    const errors: string[] = [];
    const warnings: string[] = [];
    const v = row.values;
    const get = (c: ImportColumn) => (v[c] ?? '').trim();

    const matric = get('matriculationNumber');
    const surname = get('surname');
    const firstName = get('firstName');
    if (!matric) errors.push('Matriculation number is required');
    if (!surname) errors.push('Surname is required');
    if (!firstName) errors.push('First name is required');

    // Duplicates (in-file + already-in-DB).
    if (matric) {
      const lower = matric.toLowerCase();
      if (seenInFile.has(lower)) {
        errors.push('Duplicate matriculation number within this file');
      } else {
        seenInFile.add(lower);
      }
      if (existingLower.has(lower)) {
        errors.push('A student with this matriculation number already exists');
      }
    }

    // Date of birth.
    const dob = this.parseDate(get('dateOfBirth'));
    if (!dob) errors.push('Invalid or missing date of birth (use YYYY-MM-DD)');
    else if (dob.getTime() > Date.now()) errors.push('Date of birth cannot be in the future');

    // Academic hierarchy via codes (each lookup also enforces the hierarchy).
    const faculty = catalog.facultiesByCode.get(get('facultyCode').toLowerCase());
    if (!faculty) errors.push(`Unknown faculty code "${get('facultyCode')}"`);
    let department: { id: string; facultyId: string } | undefined;
    if (faculty) {
      department = catalog.departmentsByKey.get(
        `${faculty.id}:${get('departmentCode').toLowerCase()}`,
      );
      if (!department) {
        errors.push(`Unknown department code "${get('departmentCode')}" in this faculty`);
      }
    }
    let programme:
      { id: string; departmentId: string; facultyId: string; durationYears: number } | undefined;
    if (department) {
      programme = catalog.programmesByKey.get(
        `${department.id}:${get('programmeCode').toLowerCase()}`,
      );
      if (!programme) {
        errors.push(`Unknown programme code "${get('programmeCode')}" in this department`);
      }
    }

    // Admission session (by name) or the provided default.
    let admissionSessionId: string | undefined;
    const sessionName = get('admissionSession');
    if (sessionName) {
      const s = catalog.sessionsByName.get(sessionName);
      if (!s) errors.push(`Unknown admission session "${sessionName}"`);
      else admissionSessionId = s.id;
    } else if (defaultAdmissionSessionId) {
      admissionSessionId = defaultAdmissionSessionId;
    } else {
      errors.push('Admission session is required');
    }

    // Level.
    const levelRaw = get('currentLevel');
    const level = Number(levelRaw);
    if (!levelRaw || Number.isNaN(level)) errors.push('Level is required and must be a number');
    else if (level % 100 !== 0) errors.push('Level must be a multiple of 100 (e.g. 100, 200)');
    else if (programme && level > (programme.durationYears + 2) * 100) {
      errors.push(`Level ${level} exceeds the maximum for this programme`);
    }

    // Gender / entry mode (lenient; default when blank, error when unrecognised).
    const gender = this.parseGender(get('gender'), errors);
    const entryMode = this.parseEntryMode(get('entryMode'), errors);

    // Contact of record (NOT identity). Optional; if present, validate format so
    // a typo doesn't become an undeliverable activation channel later.
    const officialEmailRaw = get('officialEmail');
    let officialEmail: string | null = null;
    if (officialEmailRaw) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(officialEmailRaw)) {
        officialEmail = officialEmailRaw.toLowerCase();
      } else {
        errors.push(`Invalid email address "${officialEmailRaw}"`);
      }
    }
    const officialPhone = get('officialPhone') || null;

    // Status.
    let studentStatusId = catalog.defaultStatusId ?? undefined;
    const statusKey = get('statusKey');
    if (statusKey) {
      const st = catalog.statusesByKey.get(statusKey.toUpperCase());
      if (!st) errors.push(`Unknown status "${statusKey}"`);
      else studentStatusId = st.id;
    }
    if (!studentStatusId) errors.push('No status resolved and no default ACTIVE status configured');

    // Scope authority — the importer may only import within their scope.
    if (faculty && department && programme) {
      try {
        assertWithinScope(scope, {
          facultyId: faculty.id,
          departmentId: department.id,
          programmeId: programme.id,
        });
      } catch (e) {
        errors.push(
          e instanceof ForbiddenException
            ? 'This record is outside your assigned scope'
            : 'Scope check failed',
        );
      }
    }

    // Soft duplicate (same name + DOB) is detected in a single batched query
    // after all rows are resolved — see applySoftDuplicateWarnings().

    const fullName = [surname, firstName].filter(Boolean).join(', ');
    const report: RowReport = {
      rowNumber: row.rowNumber,
      status: errors.length ? 'error' : warnings.length ? 'warning' : 'valid',
      matriculationNumber: matric || undefined,
      fullName: fullName || undefined,
      errors,
      warnings,
    };

    // Build the input only when the row is structurally valid (safe non-null).
    const input: StudentMasterInput = {
      matriculationNumber: matric,
      jambRegistrationNumber: get('jambRegistrationNumber') || null,
      surname,
      firstName,
      otherNames: get('otherNames') || null,
      dateOfBirth: dob ?? new Date(0),
      gender,
      facultyId: faculty?.id ?? '',
      departmentId: department?.id ?? '',
      programmeId: programme?.id ?? '',
      admissionSessionId: admissionSessionId ?? '',
      entryMode,
      currentLevel: Number.isNaN(level) ? 0 : level,
      studentStatusId,
      officialEmail,
      officialPhone,
    };

    return { rowNumber: row.rowNumber, input, report };
  }

  private parseDate(raw: string): Date | null {
    if (!raw) return null;
    // Accept ISO (YYYY-MM-DD) and DD/MM/YYYY or DD-MM-YYYY.
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (iso) {
      const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
      return this.validDate(d, +iso[1], +iso[2], +iso[3]);
    }
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
    if (dmy) {
      const d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1]));
      return this.validDate(d, +dmy[3], +dmy[2], +dmy[1]);
    }
    return null;
  }

  private validDate(d: Date, y: number, m: number, day: number): Date | null {
    if (Number.isNaN(d.getTime())) return null;
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== day)
      return null;
    return d;
  }

  private parseGender(raw: string, errors: string[]): Gender | undefined {
    if (!raw) return undefined;
    const key = raw.toUpperCase();
    const map: Record<string, Gender> = {
      M: 'MALE',
      MALE: 'MALE',
      F: 'FEMALE',
      FEMALE: 'FEMALE',
      OTHER: 'OTHER',
      O: 'OTHER',
      UNSPECIFIED: 'UNSPECIFIED',
      U: 'UNSPECIFIED',
    };
    const g = map[key];
    if (!g) errors.push(`Unrecognised gender "${raw}"`);
    return g;
  }

  private parseEntryMode(raw: string, errors: string[]): EntryMode | undefined {
    if (!raw) return undefined;
    const key = raw.toUpperCase().replace(/[\s-]/g, '_');
    const valid: EntryMode[] = ['UTME', 'DIRECT_ENTRY', 'TRANSFER', 'INTER_UNIVERSITY', 'JUPEB'];
    if ((valid as string[]).includes(key)) return key as EntryMode;
    errors.push(`Unrecognised entry mode "${raw}"`);
    return undefined;
  }
}
