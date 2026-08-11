import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthPrincipal } from '../common/auth-principal';
import { CalendarService } from './calendar.service';

/**
 * The calendar is the system clock: every time-gated operation asks it one
 * question, so the rules proven here are the ones whose failure would either open
 * registration to someone it was closed for, or close it for someone it was open
 * for.
 *
 *   • only windows whose scope CONTAINS the student are candidates;
 *   • the most specific candidate wins OUTRIGHT, even when it is closed and a
 *     broader one is open — a department that closed early has closed early;
 *   • the refusal carries a reason a student can act on, and NOT_CONFIGURED is
 *     distinct from CLOSED;
 *   • a window's scope is immutable, because re-pointing it would rewrite who was
 *     allowed to register when.
 */
const actor: AuthPrincipal = {
  userId: 'u-registry',
  userType: 'STAFF',
  email: 'registry@uni.example',
  fullName: 'Registry',
  permissions: ['structure.manage'],
  scopedPermissions: [{ permission: 'structure.manage', scope: { scopeType: 'GLOBAL' } }],
  mustChangePassword: false,
};

const OPENS = new Date('2026-01-05T00:00:00Z');
const CLOSES = new Date('2026-01-31T23:59:00Z');

const win = (over: Record<string, unknown> = {}) => ({
  id: 'w-global',
  windowType: 'REGISTRATION',
  sessionId: 'ses1',
  semesterId: 'sem1',
  scopeType: 'GLOBAL',
  facultyId: null,
  departmentId: null,
  programmeId: null,
  opensAt: OPENS,
  closesAt: CLOSES,
  isActive: true,
  notes: null,
  createdAt: new Date('2025-12-01T00:00:00Z'),
  ...over,
});

function build(prismaOver: Record<string, unknown> = {}) {
  const prisma = {
    calendarWindow: { findMany: jest.fn().mockResolvedValue([]) },
    ...prismaOver,
  } as unknown as PrismaService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  return { service: new CalendarService(prisma, audit), prisma, audit };
}

const scope = { facultyId: 'fac-sci', departmentId: 'dep-csc', programmeId: 'prog-csc' };

describe('CalendarService.resolveWindow', () => {
  it('returns null when nothing is configured', async () => {
    const { service } = build();
    await expect(service.resolveWindow('REGISTRATION', 'ses1', 'sem1', scope)).resolves.toBeNull();
  });

  it('prefers the department window over the faculty and global ones', async () => {
    const { service } = build({
      calendarWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            win(),
            win({ id: 'w-fac', scopeType: 'FACULTY', facultyId: 'fac-sci' }),
            win({ id: 'w-dep', scopeType: 'DEPARTMENT', departmentId: 'dep-csc' }),
          ]),
      },
    });
    const resolved = await service.resolveWindow('REGISTRATION', 'ses1', 'sem1', scope);
    expect(resolved?.id).toBe('w-dep');
  });

  it('prefers a programme window over every other scope', async () => {
    const { service } = build({
      calendarWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            win({ id: 'w-dep', scopeType: 'DEPARTMENT', departmentId: 'dep-csc' }),
            win({ id: 'w-prog', scopeType: 'PROGRAMME', programmeId: 'prog-csc' }),
          ]),
      },
    });
    const resolved = await service.resolveWindow('REGISTRATION', 'ses1', 'sem1', scope);
    expect(resolved?.id).toBe('w-prog');
  });

  it('prefers a semester-specific window over a session-wide one at equal scope', async () => {
    const { service } = build({
      calendarWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([win({ id: 'w-session', semesterId: null }), win({ id: 'w-sem' })]),
      },
    });
    const resolved = await service.resolveWindow('REGISTRATION', 'ses1', 'sem1', scope);
    expect(resolved?.id).toBe('w-sem');
  });

  it('breaks a tie at identical specificity with the most recently created row', async () => {
    const { service } = build({
      calendarWindow: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            win({ id: 'w-old', createdAt: new Date('2025-11-01T00:00:00Z') }),
            win({ id: 'w-new', createdAt: new Date('2025-12-20T00:00:00Z') }),
          ]),
      },
    });
    const resolved = await service.resolveWindow('REGISTRATION', 'ses1', 'sem1', scope);
    expect(resolved?.id).toBe('w-new');
  });

  /**
   * The query is what keeps another department's wave out of the running; a
   * student with no programme must not widen it into a PROGRAMME clause with an
   * undefined id.
   */
  it('only asks for windows whose scope contains the student', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = build({ calendarWindow: { findMany } });
    await service.resolveWindow('REGISTRATION', 'ses1', 'sem1', {
      facultyId: 'fac-sci',
      departmentId: null,
      programmeId: null,
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { scopeType: 'GLOBAL' },
      { scopeType: 'FACULTY', facultyId: 'fac-sci' },
    ]);
  });
});

describe('CalendarService.isWindowOpen', () => {
  const at = new Date('2026-01-10T09:00:00Z');

  it('is open inside the dates', async () => {
    const { service } = build({
      calendarWindow: { findMany: jest.fn().mockResolvedValue([win()]) },
    });
    const decision = await service.isWindowOpen('REGISTRATION', 'ses1', 'sem1', scope, at);
    expect(decision).toMatchObject({ isOpen: true, reason: null, message: null });
  });

  it('distinguishes an unconfigured calendar from a closed one', async () => {
    const { service } = build();
    const decision = await service.isWindowOpen('REGISTRATION', 'ses1', 'sem1', scope, at);
    expect(decision.isOpen).toBe(false);
    expect(decision.reason).toBe('NOT_CONFIGURED');
    expect(decision.window).toBeNull();
    expect(decision.message).toMatch(/no registration window has been set/i);
  });

  it('reports NOT_YET_OPEN with the opening date', async () => {
    const { service } = build({
      calendarWindow: { findMany: jest.fn().mockResolvedValue([win()]) },
    });
    const decision = await service.isWindowOpen(
      'REGISTRATION',
      'ses1',
      'sem1',
      scope,
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(decision.reason).toBe('NOT_YET_OPEN');
    expect(decision.message).toContain('2026-01-05');
  });

  it('reports CLOSED with the closing date, formatted in UTC', async () => {
    const { service } = build({
      calendarWindow: { findMany: jest.fn().mockResolvedValue([win()]) },
    });
    const decision = await service.isWindowOpen(
      'REGISTRATION',
      'ses1',
      'sem1',
      scope,
      new Date('2026-02-02T00:00:00Z'),
    );
    expect(decision.reason).toBe('CLOSED');
    expect(decision.message).toMatch(/closed on 2026-01-31 23:59 UTC/);
  });

  /** The emergency switch: suspended without rewriting the published dates. */
  it('reports DEACTIVATED for a suspended window still inside its dates', async () => {
    const { service } = build({
      calendarWindow: { findMany: jest.fn().mockResolvedValue([win({ isActive: false })]) },
    });
    const decision = await service.isWindowOpen('REGISTRATION', 'ses1', 'sem1', scope, at);
    expect(decision.reason).toBe('DEACTIVATED');
    expect(decision.window?.opensAt).toEqual(OPENS);
  });

  /**
   * The decision that makes staggered registration honest: the department's own
   * window answers even when it has already closed and the global one has not.
   */
  it('lets a closed department window override an open global one', async () => {
    const { service } = build({
      calendarWindow: {
        findMany: jest.fn().mockResolvedValue([
          win(),
          win({
            id: 'w-dep',
            scopeType: 'DEPARTMENT',
            departmentId: 'dep-csc',
            opensAt: new Date('2026-01-05T00:00:00Z'),
            closesAt: new Date('2026-01-08T00:00:00Z'),
          }),
        ]),
      },
    });
    const decision = await service.isWindowOpen('REGISTRATION', 'ses1', 'sem1', scope, at);
    expect(decision.isOpen).toBe(false);
    expect(decision.window?.id).toBe('w-dep');
  });
});

describe('CalendarService.createWindow', () => {
  const base = (over: Record<string, unknown> = {}) => ({
    academicSession: { findUnique: jest.fn().mockResolvedValue({ id: 'ses1' }) },
    semester: {
      findUnique: jest.fn().mockResolvedValue({ sessionId: 'ses1', name: 'First Semester' }),
    },
    faculty: { findUnique: jest.fn().mockResolvedValue({ id: 'fac-sci' }) },
    department: { findUnique: jest.fn().mockResolvedValue({ id: 'dep-csc' }) },
    programme: { findUnique: jest.fn().mockResolvedValue({ id: 'prog-csc' }) },
    calendarWindow: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => win(data)),
    },
    ...over,
  });

  const input = (over: Record<string, unknown> = {}) => ({
    windowType: 'REGISTRATION' as const,
    sessionId: 'ses1',
    semesterId: 'sem1',
    opensAt: '2026-01-05T00:00:00Z',
    closesAt: '2026-01-31T23:59:00Z',
    ...over,
  });

  it('creates a global window and records who opened it', async () => {
    const { service, prisma, audit } = build(base());
    await service.createWindow(input(), actor);
    const data = (prisma.calendarWindow.create as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ scopeType: 'GLOBAL', createdById: 'u-registry' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calendar.window.create' }),
    );
  });

  it('refuses a window that closes before it opens', async () => {
    const { service } = build(base());
    await expect(
      service.createWindow(
        input({ opensAt: '2026-02-01T00:00:00Z', closesAt: '2026-01-01T00:00:00Z' }),
        actor,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses an unparseable date rather than storing an Invalid Date', async () => {
    const { service } = build(base());
    await expect(service.createWindow(input({ opensAt: 'next monday' }), actor)).rejects.toThrow(
      /opensAt is not a valid date/i,
    );
  });

  it('refuses a semester that belongs to another session', async () => {
    const { service } = build(
      base({
        semester: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ sessionId: 'ses-other', name: 'First Semester' }),
        },
      }),
    );
    await expect(service.createWindow(input(), actor)).rejects.toThrow(
      /does not belong to that session/i,
    );
  });

  it('refuses a department-scoped window that names no department', async () => {
    const { service } = build(base());
    await expect(service.createWindow(input({ scopeType: 'DEPARTMENT' }), actor)).rejects.toThrow(
      /must name the department/i,
    );
  });

  it('refuses a scope id that does not exist', async () => {
    const { service } = build(
      base({ department: { findUnique: jest.fn().mockResolvedValue(null) } }),
    );
    await expect(
      service.createWindow(input({ scopeType: 'DEPARTMENT', departmentId: 'dep-ghost' }), actor),
    ).rejects.toThrow(NotFoundException);
  });

  /**
   * Normalisation, not merely validation: resolveWindow matches on
   * (scopeType, id), so a stray faculty id on a GLOBAL row is harmless today and a
   * trap the first time someone reads the row and believes it.
   */
  it('drops scope ids that the scope type does not use', async () => {
    const { service, prisma } = build(base());
    await service.createWindow(input({ scopeType: 'GLOBAL', facultyId: 'fac-sci' }), actor);
    const data = (prisma.calendarWindow.create as jest.Mock).mock.calls[0][0].data;
    expect(data.facultyId).toBeNull();
    expect(data.departmentId).toBeNull();
    expect(data.programmeId).toBeNull();
  });

  it('keeps a null semester for a session-wide window', async () => {
    const { service, prisma } = build(base());
    await service.createWindow(input({ semesterId: undefined }), actor);
    const data = (prisma.calendarWindow.create as jest.Mock).mock.calls[0][0].data;
    expect(data.semesterId).toBeNull();
  });
});

describe('CalendarService.updateWindow', () => {
  const base = (existing = win()) => ({
    calendarWindow: {
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...existing,
        ...data,
      })),
      findMany: jest.fn().mockResolvedValue([]),
    },
  });

  it('extends a deadline and keeps the untouched fields', async () => {
    const { service, prisma } = build(base());
    const updated = await service.updateWindow(
      'w-global',
      { closesAt: '2026-02-14T23:59:00Z' },
      actor,
    );
    expect(updated.closesAt).toEqual(new Date('2026-02-14T23:59:00Z'));
    expect(updated.opensAt).toEqual(OPENS);
    expect((prisma.calendarWindow.update as jest.Mock).mock.calls[0][0].data.isActive).toBe(true);
  });

  it('suspends a window without rewriting its published dates', async () => {
    const { service, audit } = build(base());
    const updated = await service.updateWindow('w-global', { isActive: false }, actor);
    expect(updated.isActive).toBe(false);
    expect(updated.opensAt).toEqual(OPENS);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'calendar.window.update' }),
    );
  });

  it('refuses to leave a window closing before it opens', async () => {
    const { service } = build(base());
    await expect(
      service.updateWindow('w-global', { closesAt: '2026-01-01T00:00:00Z' }, actor),
    ).rejects.toThrow(/must close after it opens/i);
  });

  it('reports a window that does not exist', async () => {
    const { service } = build({
      calendarWindow: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.updateWindow('w-ghost', { isActive: false }, actor)).rejects.toThrow(
      NotFoundException,
    );
  });

  /** A different audience is a different window: create it and suspend this one. */
  it('never writes a scope column', async () => {
    const { service, prisma } = build(base());
    await service.updateWindow(
      'w-global',
      { departmentId: 'dep-other' } as unknown as { isActive?: boolean },
      actor,
    );
    const data = (prisma.calendarWindow.update as jest.Mock).mock.calls[0][0].data;
    expect(Object.keys(data).sort()).toEqual(['closesAt', 'isActive', 'notes', 'opensAt']);
  });
});

describe('CalendarService.listWindows', () => {
  it('hides suspended windows unless asked for them', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = build({ calendarWindow: { findMany } });
    await service.listWindows({ sessionId: 'ses1' });
    expect(findMany.mock.calls[0][0].where).toMatchObject({ isActive: true });

    await service.listWindows({ sessionId: 'ses1', includeInactive: true });
    expect(findMany.mock.calls[1][0].where.isActive).toBeUndefined();
  });
});
