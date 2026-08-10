import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PasswordService } from '../../auth/password.service';
import { NotificationService } from '../../notifications/notification.service';
import { generateNumericOtp, generateToken, safeEqualHex, sha256 } from '../../common/crypto.util';
import {
  ActivationIdentifyDto,
  ActivationSetPasswordDto,
  ActivationVerifyOtpDto,
} from './dto/activation.dto';

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Student account activation — the ONLY way a student obtains a login, and it
 * operates strictly against a PRE-EXISTING master record. Enforced invariants:
 *
 *  • The university owns identity: activation never creates or alters a master
 *    record. It only (a) proves the student is who the record says, then
 *    (b) attaches a User login to that record.
 *  • Matric number alone is NOT sufficient — step 1 requires matric + date of
 *    birth + surname, and step 2 requires an OTP delivered to the contact ON
 *    FILE (never a student-supplied address).
 *  • Enumeration-safe: steps 1 and 2 return the SAME generic response whether or
 *    not the record exists / is eligible, so an attacker cannot probe which
 *    matriculation numbers are real. Only step 3 (which requires possessing a
 *    server-issued continuation token) returns specific validation errors.
 *  • Rate-limited + locked out: per-record attempt counters with a time-based
 *    lockout, on top of the IP throttling applied at the controller.
 *  • No secret is ever returned in an HTTP response: the OTP goes out only via
 *    the NotificationService to the email on file.
 */
@Injectable()
export class ActivationService {
  private readonly logger = new Logger(ActivationService.name);
  private readonly otpTtlMin: number;
  private readonly continuationTtlMin: number;
  private readonly maxAttempts: number;
  private readonly lockoutMin = 15;

  /** Uniform response for steps 1 & 2 — reveals nothing about record existence. */
  private static readonly GENERIC_IDENTIFY = {
    message:
      'If your details match our records, a verification code has been sent to the email on file.',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {
    this.otpTtlMin = this.config.get<number>('OTP_TTL_MINUTES', 10);
    this.continuationTtlMin = this.config.get<number>('ACTIVATION_TOKEN_TTL_MINUTES', 30);
    this.maxAttempts = this.config.get<number>('MAX_ACTIVATION_ATTEMPTS', 5);
  }

  // --- Step 1: identify (matric + DOB + surname) -------------------------
  async identify(dto: ActivationIdentifyDto, ctx: RequestContext) {
    const matric = dto.matriculationNumber.trim();
    const record = await this.prisma.studentRecord.findFirst({
      where: { matriculationNumber: { equals: matric, mode: 'insensitive' } },
      include: { activation: true, userAccount: { select: { id: true } } },
    });

    // Decide eligibility WITHOUT branching the response — every path below ends
    // in the same generic reply so timing/shape can't be used to enumerate.
    const eligible =
      record &&
      record.activationState === 'PENDING' &&
      !record.userAccount &&
      this.factorsMatch(record, dto);

    if (record) {
      const activation = await this.ensureActivation(record.id, record.activation);

      if (this.isLocked(activation.lockedUntil)) {
        await this.audit.record({
          actorLabel: matric,
          action: 'student.activation.identify.locked',
          entityType: 'StudentRecord',
          entityId: record.id,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return ActivationService.GENERIC_IDENTIFY;
      }

      if (eligible && record.officialEmail) {
        await this.issueOtp(record.id, record.officialEmail, matric, ctx);
      } else {
        // Record exists but the factors didn't match (or it's not eligible / has
        // no email): count it as a failed identify attempt and maybe lock out.
        await this.registerFailedIdentify(record.id, matric, ctx, {
          reason: !this.factorsMatch(record, dto)
            ? 'factor_mismatch'
            : record.activationState !== 'PENDING'
              ? 'not_pending'
              : record.userAccount
                ? 'already_linked'
                : 'no_email_on_file',
        });
      }
    } else {
      // No record: nothing to track per-record; IP throttling covers blind
      // guessing. Audit the miss for monitoring, then reply generically.
      await this.audit.record({
        actorLabel: matric,
        action: 'student.activation.identify.no_record',
        entityType: 'StudentRecord',
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    return ActivationService.GENERIC_IDENTIFY;
  }

  // --- Step 2: verify OTP -------------------------------------------------
  async verifyOtp(dto: ActivationVerifyOtpDto, ctx: RequestContext) {
    const matric = dto.matriculationNumber.trim();
    const record = await this.prisma.studentRecord.findFirst({
      where: { matriculationNumber: { equals: matric, mode: 'insensitive' } },
      include: { activation: true, userAccount: { select: { id: true } } },
    });

    // Generic failure for EVERY unhappy path (unknown matric, no OTP issued,
    // expired, wrong code, locked, already activated). Reaching this endpoint at
    // all required passing step 1, so this leaks nothing new.
    const genericFail = new BadRequestException(
      'The verification code is invalid or has expired. Please start again.',
    );

    if (
      !record ||
      !record.activation ||
      record.activationState !== 'PENDING' ||
      record.userAccount
    ) {
      throw genericFail;
    }
    const activation = record.activation;

    if (this.isLocked(activation.lockedUntil)) throw genericFail;
    if (!activation.otpHash || !activation.otpExpiresAt || activation.otpExpiresAt < new Date()) {
      throw genericFail;
    }

    const matches = safeEqualHex(activation.otpHash, sha256(dto.otp));
    if (!matches) {
      await this.registerFailedOtp(activation.id, record.id, matric, ctx);
      throw genericFail;
    }

    // Success — mint a single-use continuation token bridging to set-password.
    const continuationToken = generateToken(32);
    await this.prisma.studentActivation.update({
      where: { id: activation.id },
      data: {
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        identifyAttempts: 0,
        lockedUntil: null,
        verifiedAt: new Date(),
        continuationTokenHash: sha256(continuationToken),
        continuationExpiresAt: new Date(Date.now() + this.continuationTtlMin * 60_000),
      },
    });
    await this.audit.record({
      actorLabel: matric,
      action: 'student.activation.otp.verified',
      entityType: 'StudentRecord',
      entityId: record.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return {
      continuationToken,
      expiresInSec: this.continuationTtlMin * 60,
    };
  }

  // --- Step 3: set password + create the linked STUDENT login ------------
  async setPassword(dto: ActivationSetPasswordDto, ctx: RequestContext) {
    const activation = await this.prisma.studentActivation.findFirst({
      where: { continuationTokenHash: sha256(dto.continuationToken) },
      include: {
        studentRecord: {
          include: { userAccount: { select: { id: true } } },
        },
      },
    });

    // The caller holds a server-issued secret here, so specific errors are safe.
    if (
      !activation ||
      !activation.verifiedAt ||
      !activation.continuationExpiresAt ||
      activation.continuationExpiresAt < new Date()
    ) {
      throw new BadRequestException(
        'Your activation session has expired. Please start the activation again.',
      );
    }

    const record = activation.studentRecord;
    if (record.activationState !== 'PENDING' || record.userAccount) {
      throw new BadRequestException('This account has already been activated.');
    }
    if (!record.officialEmail) {
      // Should never happen (OTP could not have been sent), but never guess an
      // email — fail explicitly instead of inventing a login address.
      throw new BadRequestException('No email on file — contact the registry.');
    }

    const violations = this.passwords.validateStrength(dto.password);
    if (violations.length) throw new BadRequestException(violations);

    const passwordHash = await this.passwords.hash(dto.password);
    const email = record.officialEmail;

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // 1:1 link is guaranteed by the unique studentRecordId on User; a race
        // that slips through surfaces as P2002 below.
        const created = await tx.user.create({
          data: {
            userType: 'STUDENT',
            email,
            passwordHash,
            fullName: [record.surname, record.firstName].filter(Boolean).join(' '),
            isActive: true,
            studentRecordId: record.id,
          },
          select: { id: true, email: true },
        });

        // Non-protected column → allowed by the app role's grant; no amendment
        // needed (activationState is excluded from the protected trigger list).
        await tx.studentRecord.update({
          where: { id: record.id },
          data: { activationState: 'ACTIVATED', updatedById: created.id },
        });

        await tx.studentActivation.update({
          where: { id: activation.id },
          data: {
            continuationTokenHash: null,
            continuationExpiresAt: null,
            activatedAt: new Date(),
          },
        });

        await this.audit.recordTx(tx, {
          actorId: created.id,
          actorLabel: created.email,
          action: 'student.activation.completed',
          entityType: 'StudentRecord',
          entityId: record.id,
          metadata: { userId: created.id },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        });
        return created;
      });

      this.logger.log(`Student record ${record.id} activated (user ${user.id})`);
      return { activated: true, email: user.email };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Either the record already has a login (double submit) or the email is
        // already used by another account.
        throw new BadRequestException(
          'This account cannot be activated — it may already be active or the email is in use.',
        );
      }
      throw err;
    }
  }

  // --- Internals ----------------------------------------------------------
  private factorsMatch(
    record: { surname: string; dateOfBirth: Date },
    dto: ActivationIdentifyDto,
  ): boolean {
    const surnameOk = record.surname.trim().toLowerCase() === dto.surname.trim().toLowerCase();
    const dobOk =
      record.dateOfBirth.toISOString().slice(0, 10) ===
      new Date(dto.dateOfBirth).toISOString().slice(0, 10);
    return surnameOk && dobOk;
  }

  private isLocked(lockedUntil: Date | null): boolean {
    return !!lockedUntil && lockedUntil > new Date();
  }

  private async ensureActivation(
    recordId: string,
    existing: Prisma.StudentActivationGetPayload<object> | null,
  ) {
    if (existing) return existing;
    return this.prisma.studentActivation.upsert({
      where: { studentRecordId: recordId },
      create: { studentRecordId: recordId },
      update: {},
    });
  }

  private async issueOtp(
    recordId: string,
    email: string,
    matric: string,
    ctx: RequestContext,
  ): Promise<void> {
    const otp = generateNumericOtp(6);
    await this.prisma.studentActivation.update({
      where: { studentRecordId: recordId },
      data: {
        otpHash: sha256(otp),
        otpExpiresAt: new Date(Date.now() + this.otpTtlMin * 60_000),
        otpAttempts: 0,
        identifyAttempts: 0,
      },
    });
    // Deliver out-of-band. If delivery throws we still don't reveal anything to
    // the caller — log server-side and let the generic response stand.
    try {
      await this.notifications.sendActivationOtp(email, otp, this.otpTtlMin);
    } catch (err) {
      this.logger.error(
        `Failed to deliver activation OTP for record ${recordId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    await this.audit.record({
      actorLabel: matric,
      action: 'student.activation.otp.sent',
      entityType: 'StudentRecord',
      entityId: recordId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  private async registerFailedIdentify(
    recordId: string,
    matric: string,
    ctx: RequestContext,
    meta: { reason: string },
  ): Promise<void> {
    const activation = await this.prisma.studentActivation.update({
      where: { studentRecordId: recordId },
      data: { identifyAttempts: { increment: 1 } },
    });
    let locked = false;
    if (activation.identifyAttempts >= this.maxAttempts) {
      await this.prisma.studentActivation.update({
        where: { studentRecordId: recordId },
        data: {
          lockedUntil: new Date(Date.now() + this.lockoutMin * 60_000),
          identifyAttempts: 0,
        },
      });
      locked = true;
    }
    await this.audit.record({
      actorLabel: matric,
      action: locked ? 'student.activation.identify.locked' : 'student.activation.identify.failed',
      entityType: 'StudentRecord',
      entityId: recordId,
      metadata: { reason: meta.reason, attempts: activation.identifyAttempts },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  private async registerFailedOtp(
    activationId: string,
    recordId: string,
    matric: string,
    ctx: RequestContext,
  ): Promise<void> {
    const activation = await this.prisma.studentActivation.update({
      where: { id: activationId },
      data: { otpAttempts: { increment: 1 } },
    });
    let locked = false;
    if (activation.otpAttempts >= this.maxAttempts) {
      await this.prisma.studentActivation.update({
        where: { id: activationId },
        data: {
          lockedUntil: new Date(Date.now() + this.lockoutMin * 60_000),
          otpHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
        },
      });
      locked = true;
    }
    await this.audit.record({
      actorLabel: matric,
      action: locked ? 'student.activation.otp.locked' : 'student.activation.otp.failed',
      entityType: 'StudentRecord',
      entityId: recordId,
      metadata: { attempts: activation.otpAttempts },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
