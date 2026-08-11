import { Injectable } from '@nestjs/common';
import { CalendarWindow, WindowType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

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
