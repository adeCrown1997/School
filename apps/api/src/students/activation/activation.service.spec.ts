import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PasswordService } from '../../auth/password.service';
import { NotificationService } from '../../notifications/notification.service';
import { sha256 } from '../../common/crypto.util';
import { ActivationService } from './activation.service';

/**
 * Student activation is the ONLY path to a login and runs strictly against a
 * pre-existing master record. The security-critical behaviours proven here:
 *   • enumeration-safety — steps 1 & 2 return the SAME shape whether or not the
 *     record exists / matches, so matric numbers cannot be probed;
 *   • matric alone is insufficient — an OTP is only issued when surname + DOB
 *     also match AND the record is eligible;
 *   • no secret is returned — the OTP goes out only via the notification channel;
 *   • token validation — a wrong/expired OTP and a bad continuation token yield
 *     generic failures.
 */
function build(prisma: Partial<PrismaService>, notifications?: Partial<NotificationService>) {
  const config = {
    // (_key, defaultValue) => defaultValue  → otp=10, continuation=30, maxAttempts=5
    get: jest.fn((_key: string, def: number) => def),
  } as unknown as ConfigService;
  const audit = { record: jest.fn(), recordTx: jest.fn() } as unknown as AuditService;
  const passwords = {
    hash: jest.fn().mockResolvedValue('$argon2id$hash'),
    validateStrength: jest.fn().mockReturnValue([]),
  } as unknown as PasswordService;
  const notify = {
    sendActivationOtp: jest.fn().mockResolvedValue(undefined),
    ...notifications,
  } as unknown as NotificationService;
  return {
    service: new ActivationService(prisma as PrismaService, audit, passwords, notify, config),
    audit,
    notify,
  };
}

const GENERIC =
  'If your details match our records, a verification code has been sent to the email on file.';

const eligibleRecord = () => ({
  id: 'r1',
  activationState: 'PENDING',
  userAccount: null,
  activation: { id: 'a1', lockedUntil: null },
  surname: 'Bello',
  dateOfBirth: new Date('2005-01-02'),
  officialEmail: 'ada.bello@demo.example',
});

const identifyDto = {
  matriculationNumber: 'CSC/24/001',
  surname: 'bello', // case-insensitive match
  dateOfBirth: '2005-01-02',
};

describe('ActivationService.identify (enumeration-safe)', () => {
  it('returns the generic message and sends NO OTP for an unknown matric', async () => {
    const { service, notify, audit } = build({
      studentRecord: { findFirst: jest.fn().mockResolvedValue(null) } as never,
    });
    const res = await service.identify(identifyDto, {});
    expect(res).toEqual({ message: GENERIC });
    expect(notify.sendActivationOtp).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'student.activation.identify.no_record' }),
    );
  });

  it('issues an OTP (out-of-band) when all factors match an eligible record', async () => {
    const update = jest.fn().mockResolvedValue({ identifyAttempts: 0 });
    const { service, notify } = build({
      studentRecord: { findFirst: jest.fn().mockResolvedValue(eligibleRecord()) } as never,
      studentActivation: { update } as never,
    });
    const res = await service.identify(identifyDto, {});
    expect(res).toEqual({ message: GENERIC });
    expect(notify.sendActivationOtp).toHaveBeenCalledWith(
      'ada.bello@demo.example',
      expect.stringMatching(/^\d{6}$/),
      10,
    );
  });

  it('does NOT issue an OTP when the surname factor mismatches (matric alone is not enough)', async () => {
    const record = { ...eligibleRecord(), surname: 'Different' };
    const update = jest.fn().mockResolvedValue({ identifyAttempts: 1 });
    const { service, notify } = build({
      studentRecord: { findFirst: jest.fn().mockResolvedValue(record) } as never,
      studentActivation: { update } as never,
    });
    const res = await service.identify(identifyDto, {});
    expect(res).toEqual({ message: GENERIC }); // same shape → no leak
    expect(notify.sendActivationOtp).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled(); // failed-attempt counter incremented
  });
});

describe('ActivationService.verifyOtp (token validation)', () => {
  it('fails generically for an unknown matric', async () => {
    const { service } = build({
      studentRecord: { findFirst: jest.fn().mockResolvedValue(null) } as never,
    });
    await expect(
      service.verifyOtp({ matriculationNumber: 'X', otp: '123456' }, {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('fails generically and counts the attempt for a wrong code', async () => {
    const update = jest.fn().mockResolvedValue({ otpAttempts: 1 });
    const { service, audit } = build({
      studentRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          activationState: 'PENDING',
          userAccount: null,
          activation: {
            id: 'a1',
            lockedUntil: null,
            otpHash: sha256('000000'),
            otpExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      } as never,
      studentActivation: { update } as never,
    });
    await expect(
      service.verifyOtp({ matriculationNumber: 'CSC/24/001', otp: '999999' }, {}),
    ).rejects.toThrow(BadRequestException);
    expect(update).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.stringContaining('otp') }),
    );
  });

  it('fails generically for an expired code', async () => {
    const { service } = build({
      studentRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          activationState: 'PENDING',
          userAccount: null,
          activation: {
            id: 'a1',
            lockedUntil: null,
            otpHash: sha256('123456'),
            otpExpiresAt: new Date(Date.now() - 1000), // expired
          },
        }),
      } as never,
    });
    await expect(
      service.verifyOtp({ matriculationNumber: 'CSC/24/001', otp: '123456' }, {}),
    ).rejects.toThrow(/invalid or has expired/);
  });

  it('mints a single-use continuation token on a correct code and never returns the OTP', async () => {
    const update = jest.fn().mockResolvedValue({});
    const { service } = build({
      studentRecord: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'r1',
          activationState: 'PENDING',
          userAccount: null,
          activation: {
            id: 'a1',
            lockedUntil: null,
            otpHash: sha256('123456'),
            otpExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      } as never,
      studentActivation: { update } as never,
    });
    const res = await service.verifyOtp({ matriculationNumber: 'CSC/24/001', otp: '123456' }, {});
    expect(res.continuationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(res.expiresInSec).toBe(30 * 60);
    // The persisted continuation token is stored HASHED, not in the clear.
    const stored = update.mock.calls[0][0].data.continuationTokenHash as string;
    expect(stored).toBe(sha256(res.continuationToken));
  });
});

describe('ActivationService.setPassword (continuation token)', () => {
  it('rejects an unknown/expired continuation token', async () => {
    const { service } = build({
      studentActivation: { findFirst: jest.fn().mockResolvedValue(null) } as never,
    });
    await expect(
      service.setPassword({ continuationToken: 'bogus', password: 'Str0ng&Passw0rd!' }, {}),
    ).rejects.toThrow(/activation session has expired/);
  });
});
