import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../finance/ledger.service';
import { formatMinor } from '../finance/finance.constants';
import { CalendarService } from './calendar.service';
import {
  ELIGIBILITY_GATES,
  EligibilityGateKey,
  REGISTRABLE_STATUS_KEYS,
  maxAllowedSessions,
} from './registration.constants';

/**
 * The five eligibility gates of docs/03 §9.1.
 *
 * TWO DELIBERATE DEPARTURES from the letter of the spec, both in the same
 * direction — toward telling the student the truth:
 *
 *  1. Gates are ALL evaluated, not short-circuited. The spec says "evaluated in
 *     order; all must pass", and a fail-fast reading is cheaper. But a student
 *     who fixes the first refusal only to meet a second one has made two trips
 *     to two different offices, which is exactly the support load §9.1 warns
 *     about ("You are not eligible" is a support-ticket generator). One round
 *     trip, the whole picture.
 *  2. A gate that cannot be decided reports NOT_ENFORCED rather than passing
 *     silently. Fee clearance is the live case: the finance module does not
 *     exist yet, so there are no invoices to clear. Reporting that plainly
 *     means nobody later mistakes an unbuilt gate for a satisfied one.
 *
 * The result is advisory for display and authoritative for submission — the
 * registration service calls assertCanRegister, which refuses on the same data
 * rather than trusting that the client checked.
 */
export interface GateResult {
  gate: EligibilityGateKey;
  passed: boolean;
  /** True when the gate could not be decided (see note 2 above). */
  notEnforced?: boolean;
  /** Actionable, student-facing. Null only when the gate passed cleanly. */
  message: string | null;
}

export interface EligibilityReport {
  eligible: boolean;
  gates: GateResult[];
  /** Context the caller needs anyway, resolved here to save a second query. */
  student: {
    id: string;
    matriculationNumber: string;
    fullName: string;
    level: number;
    facultyId: string;
    departmentId: string;
    programmeId: string;
    curriculumVersionId: string | null;
  };
  /** The window that decided GATE 2, when one is configured. */
  window: { id: string; opensAt: Date; closesAt: Date } | null;
}

@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: CalendarService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Evaluate every gate for one student in one semester.
   *
   * `at` is injectable so the window gate is testable without waiting for a
   * calendar date, and so a late-registration review can ask "would this have
   * passed on the day they claim they tried?".
   */
  async evaluate(
    studentRecordId: string,
    sessionId: string,
    semesterId: string,
    at: Date = new Date(),
  ): Promise<EligibilityReport> {
    const student = await this.prisma.studentRecord.findUnique({
      where: { id: studentRecordId },
      include: {
        studentStatus: { select: { key: true, label: true, isTerminal: true } },
        programme: { select: { id: true, code: true, durationYears: true, isActive: true } },
        admissionSession: { select: { id: true, name: true, startDate: true } },
        userAccount: { select: { id: true, isActive: true } },
        // Only live holds matter; a released hold is history.
        holds: {
          where: { releasedAt: null, blocksRegistration: true },
          select: { holdType: true, reason: true },
        },
      },
    });
    if (!student) throw new NotFoundException('Student record not found');

    const session = await this.prisma.academicSession.findUnique({
      where: { id: sessionId },
      select: { id: true, name: true, startDate: true, state: true },
    });
    if (!session) throw new NotFoundException('Academic session not found');

    const scope = {
      facultyId: student.facultyId,
      departmentId: student.departmentId,
      programmeId: student.programmeId,
    };

    const windowDecision = await this.calendar.isWindowOpen(
      'REGISTRATION',
      sessionId,
      semesterId,
      scope,
      at,
    );

    const gates: GateResult[] = [
      this.gateAccount(student),
      {
        gate: ELIGIBILITY_GATES.WINDOW,
        passed: windowDecision.isOpen,
        message: windowDecision.message,
      },
      await this.gateFeeClearance(studentRecordId, sessionId, session.name),
      this.gateHolds(student.holds),
      this.gateDuration(student, session),
    ];

    return {
      // notEnforced gates do not block. That is the honest reading of an
      // undecidable gate, and it is recorded in the report so a reviewer can see
      // which gates actually spoke.
      eligible: gates.every((g) => g.passed || g.notEnforced === true),
      gates,
      student: {
        id: student.id,
        matriculationNumber: student.matriculationNumber,
        fullName: [student.surname, student.firstName, student.otherNames]
          .filter(Boolean)
          .join(' '),
        level: student.currentLevel,
        facultyId: student.facultyId,
        departmentId: student.departmentId,
        programmeId: student.programmeId,
        curriculumVersionId: student.curriculumVersionId,
      },
      window: windowDecision.window
        ? {
            id: windowDecision.window.id,
            opensAt: windowDecision.window.opensAt,
            closesAt: windowDecision.window.closesAt,
          }
        : null,
    };
  }

  /**
   * The enforcing form. Throws with the FIRST blocking reason but names how many
   * others there are, so the message is short while the report stays complete.
   *
   * This is what the registration service calls. The client's own eligibility
   * check is a courtesy; a caller who skips it is stopped here.
   */
  async assertCanRegister(
    studentRecordId: string,
    sessionId: string,
    semesterId: string,
    at: Date = new Date(),
  ): Promise<EligibilityReport> {
    const report = await this.evaluate(studentRecordId, sessionId, semesterId, at);
    if (report.eligible) return report;

    const blocking = report.gates.filter((g) => !g.passed && g.notEnforced !== true);
    const extra = blocking.length > 1 ? ` (and ${blocking.length - 1} other issue(s))` : '';
    throw new ForbiddenException({
      code: 'REGISTRATION_NOT_ELIGIBLE',
      message: `${blocking[0]?.message ?? 'You are not eligible to register.'}${extra}`,
      details: blocking.map((g) => ({ gate: g.gate, message: g.message })),
    });
  }

  // --- Gate 1: account + status -------------------------------------------

  private gateAccount(student: {
    activationState: string;
    userAccount: { isActive: boolean } | null;
    studentStatus: { key: string; label: string; isTerminal: boolean };
  }): GateResult {
    const fail = (message: string): GateResult => ({
      gate: ELIGIBILITY_GATES.ACCOUNT,
      passed: false,
      message,
    });

    if (student.activationState !== 'ACTIVATED' || !student.userAccount) {
      return fail('Your account is not activated yet. Activate it before registering.');
    }
    if (!student.userAccount.isActive) {
      return fail('Your account is deactivated. Contact the registry.');
    }
    // Terminal is checked before the allowlist so a graduate gets "you have
    // graduated" instead of the generic status message.
    if (student.studentStatus.isTerminal) {
      return fail(
        `Your record is ${student.studentStatus.label.toLowerCase()}, which ends registration.`,
      );
    }
    if (!REGISTRABLE_STATUS_KEYS.includes(student.studentStatus.key as 'ACTIVE' | 'PROBATION')) {
      return fail(
        `Registration is not open to students with status ${student.studentStatus.label}. ` +
          'Contact the registry to have your status reviewed.',
      );
    }
    return { gate: ELIGIBILITY_GATES.ACCOUNT, passed: true, message: null };
  }

  // --- Gate 3: fee clearance ----------------------------------------------

  /**
   * §11.4 defines clearance as a QUERY, not a flag: the ledger balance is
   * satisfied, OR an approved waiver covers the shortfall, OR an approved loan
   * clearance does (Q-39). The naive `fees_paid` boolean breaks the moment a
   * student is loan-funded, which R16 shows is now mainstream.
   *
   * The query itself lives in LedgerService so registration, exams and the
   * clearance module all ask the SAME derived question (INV-16). Three
   * outcomes:
   *   • no invoice issued for the session → NOT_ENFORCED. There is nothing to
   *     clear; saying "you have paid" would be a claim this code cannot support.
   *   • invoice settled (payment, approved waiver or loan clearance) → pass.
   *   • outstanding balance → fail, with the amount.
   */
  private async gateFeeClearance(
    studentRecordId: string,
    sessionId: string,
    sessionName: string,
  ): Promise<GateResult> {
    const verdict = await this.ledger.clearance(studentRecordId, sessionId);

    if (!verdict.invoiced) {
      return {
        gate: ELIGIBILITY_GATES.FEE_CLEARANCE,
        passed: false,
        notEnforced: true,
        message: `No fee invoice has been issued for ${sessionName}, so fee clearance is not being checked.`,
      };
    }

    if (!verdict.cleared) {
      return {
        gate: ELIGIBILITY_GATES.FEE_CLEARANCE,
        passed: false,
        message:
          `You have an outstanding balance of ${formatMinor(verdict.shortfall)} for ${sessionName}. ` +
          'Clear it — or obtain an approved waiver or loan clearance — before registering.',
      };
    }
    return { gate: ELIGIBILITY_GATES.FEE_CLEARANCE, passed: true, message: null };
  }

  // --- Gate 4: holds -------------------------------------------------------

  private gateHolds(holds: Array<{ holdType: string; reason: string }>): GateResult {
    if (holds.length === 0) {
      return { gate: ELIGIBILITY_GATES.HOLDS, passed: true, message: null };
    }
    // The hold TYPE tells the student which office to go to, which is the whole
    // point of naming it rather than saying "a hold exists".
    const types = [...new Set(holds.map((h) => h.holdType))].join(', ');
    return {
      gate: ELIGIBILITY_GATES.HOLDS,
      passed: false,
      message:
        `A registration hold is on your record (${types}). ` +
        `Reason: ${holds[0].reason}. It must be released before you can register.`,
    };
  }

  // --- Gate 5: maximum duration -------------------------------------------

  /**
   * §8.4. Counted in SESSIONS elapsed since admission rather than in years of
   * wall-clock time: a student who deferred a session has used a session, and
   * comparing calendar dates would either forgive that or punish a late intake.
   * Admission session inclusive, hence the +1.
   */
  private gateDuration(
    student: {
      programme: { code: string; durationYears: number };
      admissionSession: { name: string; startDate: Date };
    },
    session: { name: string; startDate: Date },
  ): GateResult {
    const sessionsElapsed = this.sessionSpan(student.admissionSession.startDate, session.startDate);
    const allowed = maxAllowedSessions(student.programme.durationYears);

    if (sessionsElapsed > allowed) {
      return {
        gate: ELIGIBILITY_GATES.DURATION,
        passed: false,
        message:
          `${student.programme.code} allows ${allowed} sessions and you were admitted in ` +
          `${student.admissionSession.name} (${sessionsElapsed} sessions ago). ` +
          'Registration requires an approved extension from your faculty.',
      };
    }
    return { gate: ELIGIBILITY_GATES.DURATION, passed: true, message: null };
  }

  /**
   * Sessions from one start date to another, inclusive of both ends. Rounded
   * from the day count rather than differencing calendar years, because an
   * academic session straddles the new year and a year-difference would count
   * 2024/2025 → 2025/2026 as two boundaries in some months and one in others.
   */
  private sessionSpan(from: Date, to: Date): number {
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0) return 1;
    return Math.round(days / 365.25) + 1;
  }
}
