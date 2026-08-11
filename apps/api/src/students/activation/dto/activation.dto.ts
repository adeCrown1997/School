import { Transform } from 'class-transformer';
import { IsISO8601, IsString, Length, Matches } from 'class-validator';
import {
  MATRIC_FORMAT_MESSAGE,
  MATRIC_MAX_LENGTH,
  MATRIC_MIN_LENGTH,
  MATRIC_PATTERN,
  normalizeMatriculationNumber,
} from '../../matriculation';

/**
 * Activation is a MULTI-FACTOR identity challenge against a PRE-EXISTING record.
 * A matriculation number ALONE is never sufficient (INV: "Do not use matric
 * number alone as sufficient authentication") — the student must also prove
 * date of birth and surname. There is deliberately no field by which a student
 * could assert any identity attribute; these DTOs only carry proof-of-knowledge,
 * never data that would create or alter a record.
 *
 * Note what is absent from ActivationActivateDto: a password. The initial
 * password is the surname held on the master record, so activation never lets
 * the caller choose one — a chosen password would be a fourth "factor" the
 * student invents, which is exactly what the forced first-login change replaces.
 */

/** The matric field decorators are repeated rather than factored into a
 *  composite decorator, matching how every other DTO in the codebase is written. */

/**
 * Activation — matric + DOB + surname (three factors, not one).
 *
 * This is the WHOLE flow when email verification is disabled (the default): the
 * three factors are checked against the master record and the login account is
 * created in the same request, with the surname as the initial password and
 * `mustChangePassword` set. When STUDENT_ACTIVATION_REQUIRE_EMAIL_OTP=true the
 * same payload instead starts the OTP flow below.
 */
export class ActivationIdentifyDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeMatriculationNumber(value) : value,
  )
  @Length(MATRIC_MIN_LENGTH, MATRIC_MAX_LENGTH, { message: MATRIC_FORMAT_MESSAGE })
  @Matches(MATRIC_PATTERN, { message: MATRIC_FORMAT_MESSAGE })
  matriculationNumber!: string;

  @IsISO8601()
  dateOfBirth!: string;

  @IsString()
  @Length(1, 80)
  surname!: string;
}

/** OTP step — retained for the email-verification path, skipped by default. */
export class ActivationVerifyOtpDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeMatriculationNumber(value) : value,
  )
  @Length(MATRIC_MIN_LENGTH, MATRIC_MAX_LENGTH, { message: MATRIC_FORMAT_MESSAGE })
  @Matches(MATRIC_PATTERN, { message: MATRIC_FORMAT_MESSAGE })
  matriculationNumber!: string;

  @IsString()
  @Length(4, 10)
  @Matches(/^[0-9]+$/, { message: 'The code must be numeric' })
  otp!: string;
}

/** OTP step — set the password using the continuation token from the OTP step. */
export class ActivationSetPasswordDto {
  @IsString()
  @Length(16, 128)
  continuationToken!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
