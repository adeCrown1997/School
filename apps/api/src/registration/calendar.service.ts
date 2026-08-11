import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CalendarWindow, ScopeType, WindowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * The academic calendar as the system clock (docs/03 §8.1).
 *
 * Every time-gated operation in the system asks ONE question — is this window
 * open for this scope, at this instant — instead of each module inventing its
 * own date columns. That is why this returns a *decision object* rather than a
 * boolean: the caller almost always needs to explain the refusal ("registration
 * closed on 12 October"), and a bare `false` forces every call site to re-query
 * for the reason.
 *
 * RESOLUTION IS MOST-SPECIFIC-FIRST: a programme window overrides its
 * department's, which overrides its faculty's, which overrides the global one.
 * This is what makes staggered registration (docs/03 §9.5 — open by department
 * in waves, the cheapest load control there is) expressible as data rather than
 * as a deployment.
 *
 * Only ONE window applies: the most specific match wins outright, even if it is
 * currently closed while a broader one is open. A department that closes early
 * has closed early; inheriting the faculty's later date would silently undo the
 * decision.
 */
export interface WindowScope {
  facultyId?: string | null;
  departmentId?: string | null;
  programmeId?: string | null;
}

export interface WindowDecision {
  /** True only when a window applies AND now falls inside it. */
  isOpen: boolean;
  /** The window that decided this, or null when none is configured. */
  window: CalendarWindow | null;
  /**
   * Why it is closed, in a form a student can act on. Null when open.
   * `NOT_CONFIGURED` is deliberately distinct from `CLOSED`: an unconfigured
   * calendar is an administrative omission, not a decision about the student.
   */
  reason: 'NOT_CONFIGURED' | 'NOT_YET_OPEN' | 'CLOSED' | 'DEACTIVATED' | null;
  message: string | null;
}

/** What a caller supplies to open a window. Dates arrive as ISO strings. */
export interface CalendarWindowInput {
  windowType: WindowType;
  sessionId: string;
  semesterId?: string | null;
  scopeType?: ScopeType;
  facultyId?: string | null;
  departmentId?: string | null;
  programmeId?: string | null;
  opensAt: string | Date;
  closesAt: string | Date;
  notes?: string | null;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Resolve the one window governing (type, session, semester) for a scope.
   *
   * Semester handling: a window may be semester-specific (REGISTRATION) or
   * session-wide (CLEARANCE runs across both semesters, so its row has a null
   * semesterId). Both are candidates for a semester-scoped question, with the
   * semester-specific one preferred — the same most-specific-wins rule applied
   * to time rather than to organisational scope.
   */
  async resolveWindow(
    windowType: WindowType,
    sessionId: string,
    semesterId: string | null,
    scope: WindowScope,
  ): Promise<CalendarWindow | null> {
    const candidates = await this.prisma.calendarWindow.findMany({
      where: {
        windowType,
        sessionId,
        // Session-wide rows (null semester) apply to every semester in the
        // session, so they stay in the running.
        ...(semesterId ? { OR: [{ semesterId }, { semesterId: null }] } : {}),
        // A window is only a candidate if its scope CONTAINS the student. A row
        // for another department must never be considered, or a wave opened for
        // Physics would answer for a Chemistry student.
        OR: [
          { scopeType: 'GLOBAL' },
          ...(scope.facultyId
            ? [{ scopeType: 'FACULTY' as const, facultyId: scope.facultyId }]
            : []),
          ...(scope.departmentId
            ? [{ scopeType: 'DEPARTMENT' as const, departmentId: scope.departmentId }]
            : []),
          ...(scope.programmeId
            ? [{ scopeType: 'PROGRAMME' as const, programmeId: scope.programmeId }]
            : []),
        ],
      },
    });
    if (candidates.length === 0) return null;

    // Rank explicitly rather than relying on an ORDER BY over an enum: the
    // enum's declaration order is not a specificity order, and depending on it
    // would break the moment someone adds a value in the middle.
    const specificity: Record<string, number> = {
      PROGRAMME: 4,
      DEPARTMENT: 3,
      FACULTY: 2,
      GLOBAL: 1,
    };
    const ranked = [...candidates].sort((a, b) => {
      const byScope = (specificity[b.scopeType] ?? 0) - (specificity[a.scopeType] ?? 0);
      if (byScope !== 0) return byScope;
      // Semester-specific beats session-wide at equal scope.
      const bySemester = (b.semesterId ? 1 : 0) - (a.semesterId ? 1 : 0);
      if (bySemester !== 0) return bySemester;
      // Last resort: the most recently created row. Two rows at identical
      // specificity are a configuration mistake, but a deterministic answer
      // beats an arbitrary one — and the newest edit is the likelier intent.
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    return ranked[0];
  }

  /** Resolve, then decide — with a message the caller can show verbatim. */
  async isWindowOpen(
    windowType: WindowType,
    sessionId: string,
    semesterId: string | null,
    scope: WindowScope,
    at: Date = new Date(),
  ): Promise<WindowDecision> {
    const window = await this.resolveWindow(windowType, sessionId, semesterId, scope);
    const label = this.label(windowType);

    if (!window) {
      return {
        isOpen: false,
        window: null,
        reason: 'NOT_CONFIGURED',
        message: `No ${label} window has been set for this session. Contact your department.`,
      };
    }
    // isActive is separate from the dates precisely so an emergency close does
    // not require rewriting history — the dates stay as published.
    if (!window.isActive) {
      return {
        isOpen: false,
        window,
        reason: 'DEACTIVATED',
        message: `The ${label} window is currently suspended. Contact your department.`,
      };
    }
    if (at < window.opensAt) {
      return {
        isOpen: false,
        window,
        reason: 'NOT_YET_OPEN',
        message: `${this.capitalize(label)} opens on ${this.format(window.opensAt)}.`,
      };
    }
    if (at > window.closesAt) {
      return {
        isOpen: false,
        window,
        reason: 'CLOSED',
        message: `${this.capitalize(label)} closed on ${this.format(window.closesAt)}.`,
      };
    }
    return { isOpen: true, window, reason: null, message: null };
  }

  // --- administration ------------------------------------------------------

  /**
   * List windows. Inactive rows are hidden by default but never deleted: a
   * suspended window's dates are what was published, and an audit of "when could
   * students register?" needs them to still exist.
   */
  async listWindows(filters: {
    windowType?: WindowType;
    sessionId?: string;
    semesterId?: string;
    includeInactive?: boolean;
  }) {
    return this.prisma.calendarWindow.findMany({
      where: {
        windowType: filters.windowType,
        sessionId: filters.sessionId,
        semesterId: filters.semesterId,
        ...(filters.includeInactive ? {} : { isActive: true }),
      },
      include: {
        session: { select: { id: true, name: true } },
        semester: { select: { id: true, name: true } },
        faculty: { select: { id: true, name: true } },
        department: { select: { id: true, name: true } },
        programme: { select: { id: true, name: true } },
      },
      orderBy: [{ opensAt: 'asc' }, { scopeType: 'asc' }],
    });
  }

  async createWindow(input: CalendarWindowInput, actor: AuthPrincipal) {
    const data = await this.validateWindow(input);
    const created = await this.prisma.calendarWindow.create({
      data: { ...data, notes: input.notes ?? null, createdById: actor.userId },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'calendar.window.create',
      entityType: 'CalendarWindow',
      entityId: created.id,
      after: this.snapshot(created),
    });
    return created;
  }

  /**
   * Change a window's dates, notes or active flag.
   *
   * The SCOPE is deliberately immutable. Re-pointing a window from one department
   * to another rewrites who was allowed to register when, and leaves no trace that
   * the earlier audience ever had a window. A different audience is a different
   * window: create it, and suspend this one.
   */
  async updateWindow(
    id: string,
    patch: {
      opensAt?: string | Date;
      closesAt?: string | Date;
      notes?: string | null;
      isActive?: boolean;
    },
    actor: AuthPrincipal,
  ) {
    const before = await this.prisma.calendarWindow.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Calendar window not found');

    const opensAt =
      patch.opensAt !== undefined ? this.parseDate(patch.opensAt, 'opensAt') : before.opensAt;
    const closesAt =
      patch.closesAt !== undefined ? this.parseDate(patch.closesAt, 'closesAt') : before.closesAt;
    if (closesAt <= opensAt) {
      throw new BadRequestException('A window must close after it opens');
    }

    const updated = await this.prisma.calendarWindow.update({
      where: { id },
      data: {
        opensAt,
        closesAt,
        notes: patch.notes !== undefined ? patch.notes : before.notes,
        isActive: patch.isActive !== undefined ? patch.isActive : before.isActive,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'calendar.window.update',
      entityType: 'CalendarWindow',
      entityId: id,
      before: this.snapshot(before),
      after: this.snapshot(updated),
    });
    return updated;
  }

  /**
   * Validate a window before it becomes data.
   *
   * The scope ids are NORMALIZED, not merely checked: a GLOBAL window carries no
   * faculty id even if one was posted. resolveWindow matches on (scopeType, id),
   * so a stray id is harmless today and a trap the first time someone reads the
   * row and believes it.
   */
  private async validateWindow(input: CalendarWindowInput) {
    const opensAt = this.parseDate(input.opensAt, 'opensAt');
    const closesAt = this.parseDate(input.closesAt, 'closesAt');
    if (closesAt <= opensAt) throw new BadRequestException('A window must close after it opens');

    const session = await this.prisma.academicSession.findUnique({
      where: { id: input.sessionId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Academic session not found');

    if (input.semesterId) {
      const semester = await this.prisma.semester.findUnique({
        where: { id: input.semesterId },
        select: { sessionId: true, name: true },
      });
      if (!semester) throw new NotFoundException('Semester not found');
      if (semester.sessionId !== input.sessionId) {
        throw new BadRequestException(`${semester.name} does not belong to that session`);
      }
    }

    const scopeType = input.scopeType ?? ScopeType.GLOBAL;
    let facultyId: string | null = null;
    let departmentId: string | null = null;
    let programmeId: string | null = null;

    if (scopeType === ScopeType.FACULTY) {
      facultyId = await this.requireScopeId('faculty', input.facultyId);
    } else if (scopeType === ScopeType.DEPARTMENT) {
      departmentId = await this.requireScopeId('department', input.departmentId);
    } else if (scopeType === ScopeType.PROGRAMME) {
      programmeId = await this.requireScopeId('programme', input.programmeId);
    }

    return {
      windowType: input.windowType,
      sessionId: input.sessionId,
      semesterId: input.semesterId ?? null,
      scopeType,
      facultyId,
      departmentId,
      programmeId,
      opensAt,
      closesAt,
    };
  }

  private async requireScopeId(
    kind: 'faculty' | 'department' | 'programme',
    id: string | null | undefined,
  ): Promise<string> {
    if (!id) {
      throw new BadRequestException(`A ${kind}-scoped window must name the ${kind}`);
    }
    const exists =
      kind === 'faculty'
        ? await this.prisma.faculty.findUnique({ where: { id }, select: { id: true } })
        : kind === 'department'
          ? await this.prisma.department.findUnique({ where: { id }, select: { id: true } })
          : await this.prisma.programme.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException(`${this.capitalize(kind)} not found`);
    return id;
  }

  private parseDate(value: string | Date, field: string): Date {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} is not a valid date`);
    return d;
  }

  /** Flat, JSON-safe view of a window for the audit trail. */
  private snapshot(w: CalendarWindow) {
    return {
      windowType: w.windowType,
      sessionId: w.sessionId,
      semesterId: w.semesterId,
      scopeType: w.scopeType,
      facultyId: w.facultyId,
      departmentId: w.departmentId,
      programmeId: w.programmeId,
      opensAt: w.opensAt.toISOString(),
      closesAt: w.closesAt.toISOString(),
      isActive: w.isActive,
      notes: w.notes,
    };
  }

  private label(windowType: WindowType): string {
    return windowType.toLowerCase().replace(/_/g, ' ');
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * Dates are formatted in UTC on purpose. The alternative is the server's local
   * zone, which makes the same deadline read differently depending on where the
   * process happens to run — the one thing a published deadline must not do.
   */
  private format(d: Date): string {
    return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  }
}
