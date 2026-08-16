import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal } from '../common/auth-principal';
import { WithholdingService } from './withholding.service';

/**
 * STUDENT result self-service (docs/03 §10.5–§10.7), under /api/v1/me/results.
 *
 * Ownership-bound: a student sees ONLY their own published grades, semester
 * GPAs and active withholdings, keyed on the principal's linked
 * studentRecordId. Nothing here reads a permission — the STUDENT role carries
 * none. Grades become visible once published; a withholding hides the VALUE of
 * the affected row but is still NAMED by course and reason (§10.7: the student
 * sees "withheld", never a silent blank).
 */
@Injectable()
export class ResultsSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly withholdings: WithholdingService,
  ) {}

  /**
   * The whole results screen in one call: per-semester grade rows, the running
   * GPA table, and any active withholdings (with reasons).
   */
  async own(studentRecordId: string) {
    const records = await this.prisma.gradeRecord.findMany({
      where: {
        studentRecordId,
        publishedAt: { not: null },
        supersededById: null, // the current grade per line (INV-12)
      },
      include: {
        course: { select: { id: true, code: true, title: true, level: true } },
        session: { select: { id: true, name: true, startDate: true } },
        semester: { select: { id: true, name: true, sequence: true } },
      },
      orderBy: [{ session: { startDate: 'asc' } }, { semester: { sequence: 'asc' } }],
    });

    const gpas = await this.prisma.semesterGpa.findMany({
      where: { studentRecordId },
      include: {
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true, sequence: true } },
      },
      orderBy: { computedAt: 'asc' },
    });

    const withholdings = await this.withholdings.activeFor(studentRecordId);
    const withheldOfferingIds = new Set(
      withholdings.filter((w) => w.offeringId).map((w) => w.offeringId as string),
    );
    // Session-wide withholdings blank out every row published in that session.
    const withheldSessionIds = new Set(
      withholdings.filter((w) => !w.offeringId && w.sessionId).map((w) => w.sessionId as string),
    );

    const isWithheld = (sessionId: string, offeringId: string) =>
      withheldOfferingIds.has(offeringId) || withheldSessionIds.has(sessionId);

    return {
      grades: records
        .filter((r) => !isWithheld(r.sessionId, r.offeringId))
        .map((r) => ({
          id: r.id,
          code: r.course.code,
          title: r.course.title,
          level: r.course.level,
          session: r.session.name,
          sessionId: r.session.id,
          semester: r.semester.name,
          semesterSequence: r.semester.sequence,
          creditUnits: r.creditUnits,
          totalScore: r.totalScore,
          grade: r.grade,
          gradePoint: r.gradePoint,
          mark: r.mark,
          isCarryover: r.isCarryover,
          publishedAt: r.publishedAt,
        })),
      gpas: gpas.map((g) => ({
        id: g.id,
        session: g.session.name,
        semester: g.semester.name,
        level: g.level,
        unitsRegistered: g.unitsRegistered,
        unitsPassed: g.unitsPassed,
        gpa: g.gpa,
        cumulativeUnits: g.cumulativeUnits,
        cgpa: g.cgpa,
      })),
      withholdings: withholdings.map((w) => ({
        id: w.id,
        reason: w.reason,
        placedAt: w.placedAt,
        course: w.offering?.course.code ?? null,
        session: w.session?.name ?? null,
      })),
      /** Courses whose grade exists but is hidden behind a withholding — the
       *  student is told WHAT is withheld without seeing the value. */
      withheldCourseCodes: [
        ...new Set(
          records.filter((r) => isWithheld(r.sessionId, r.offeringId)).map((r) => r.course.code),
        ),
      ],
    };
  }

  /** One owned, published, current grade row — or null when the id does not
   *  belong to the caller (the controller maps null → 404, revealing nothing). */
  async findOne(id: string, studentRecordId: string) {
    const grade = await this.prisma.gradeRecord.findFirst({
      where: { id, studentRecordId, publishedAt: { not: null }, supersededById: null },
      include: {
        course: { select: { code: true, title: true, level: true, creditUnits: true } },
        session: { select: { name: true } },
        semester: { select: { name: true } },
        gradeScale: { select: { name: true } },
      },
    });
    if (!grade) return null;
    const withheldOfferingIds = new Set(
      (await this.withholdings.activeFor(studentRecordId, grade.sessionId))
        .filter((w) => w.offeringId)
        .map((w) => w.offeringId as string),
    );
    if (withheldOfferingIds.has(grade.offeringId)) return null; // hidden = absent
    return grade;
  }
}

/** Refuses a non-student principal and returns the linked record id. */
export function assertStudentPrincipal(actor: AuthPrincipal): string {
  if (!actor.studentRecordId) {
    throw new ForbiddenException('This endpoint is only available to an activated student account');
  }
  return actor.studentRecordId;
}
