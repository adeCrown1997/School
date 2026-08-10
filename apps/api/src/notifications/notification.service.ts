import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Outbound notification channel (email/SMS). This is the TRUSTED delivery path
 * for secrets that must NOT travel in an HTTP response — activation OTPs, and
 * later password-reset links. Deliberately abstracted so a real provider
 * (SES/SendGrid/SMTP) can be dropped in without touching business logic.
 *
 * Phase 1 has no email provider wired, so in non-production the message is
 * logged server-side (never returned to the caller). Returning an OTP to the
 * requester would defeat the whole point of a second factor, so we never do.
 * In production without a provider configured, we FAIL LOUD rather than
 * silently drop a security-critical message.
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly isProd: boolean;

  constructor(private readonly config: ConfigService) {
    this.isProd = this.config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Deliver a one-time activation code to the student's email ON FILE. The
   * recipient address is the officialEmail the institution captured — never a
   * client-supplied address.
   */
  async sendActivationOtp(to: string, otp: string, ttlMinutes: number): Promise<void> {
    const subject = 'Your ePortal activation code';
    const body =
      `Your account activation code is ${otp}. ` +
      `It expires in ${ttlMinutes} minutes. ` +
      `If you did not request this, you can ignore this message.`;
    await this.deliver(to, subject, body);
  }

  private async deliver(to: string, subject: string, body: string): Promise<void> {
    // A real provider integration goes here (guarded by UPLOAD-style env). Until
    // then: dev logs the payload; prod refuses to pretend it was sent.
    if (this.isProd) {
      this.logger.error(
        `No email provider configured — cannot deliver "${subject}". ` +
          `Configure a mail transport before enabling activation in production.`,
      );
      throw new Error('Notification transport is not configured');
    }
    this.logger.debug(`[DEV notification] to=${to} subject="${subject}" body="${body}"`);
  }
}
