import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Auth DTOs. These carry ONLY credential material — never any student-identity
 * or role field. class-validator enforces shape at the edge; the service layer
 * re-checks policy. whitelist+forbidNonWhitelisted in the global pipe strips
 * and rejects unexpected properties, so a client cannot smuggle extra fields.
 */
export class LoginDto {
  /**
   * A matriculation number (students) or an email address (staff). One field for
   * both because the shapes are unambiguous — `resolveLoginIdentifier` decides
   * which it is by testing MATRIC_PATTERN — and because a single field cannot
   * leak which kind of account exists: an unknown identifier of either shape
   * gets the same generic failure.
   *
   * Validated only as a non-empty bounded string: a stricter rule here would
   * reject bad input with a DIFFERENT error than a wrong password, which is an
   * enumeration signal. 320 is the email ceiling and comfortably clears
   * MATRIC_MAX_LENGTH.
   */
  @IsString()
  @IsNotEmpty({ message: 'Matriculation number or email is required' })
  @MaxLength(320)
  identifier!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MaxLength(200)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'A valid email is required' })
  @MaxLength(320)
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(200)
  newPassword!: string;
}
