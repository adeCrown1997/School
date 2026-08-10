import { IsISO8601, IsString, Length, Matches } from 'class-validator';

/**
 * Activation is a MULTI-FACTOR identity challenge against a PRE-EXISTING record.
 * A matriculation number ALONE is never sufficient (INV: "Do not use matric
 * number alone as sufficient authentication") — the student must also prove
 * date of birth and surname, and then possess the OTP delivered to the contact
 * on file. There is deliberately no field by which a student could assert any
 * identity attribute; these DTOs only carry proof-of-knowledge, never data that
 * would create or alter a record.
 */

/** Step 1 — identify: matric + DOB + surname (three factors, not one). */
export class ActivationIdentifyDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9/\-.]+$/, {
    message: 'Matriculation number contains invalid characters',
  })
  matriculationNumber!: string;

  @IsISO8601()
  dateOfBirth!: string;

  @IsString()
  @Length(1, 80)
  surname!: string;
}

/** Step 2 — verify the OTP sent to the email on file. */
export class ActivationVerifyOtpDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9/\-.]+$/)
  matriculationNumber!: string;

  @IsString()
  @Length(4, 10)
  @Matches(/^[0-9]+$/, { message: 'The code must be numeric' })
  otp!: string;
}

/** Step 3 — set the password using the continuation token from step 2. */
export class ActivationSetPasswordDto {
  @IsString()
  @Length(16, 128)
  continuationToken!: string;

  @IsString()
  @Length(8, 128)
  password!: string;
}
