import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { EntryMode, Gender } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * ADMIN create-student payload. The administrator/registry IS the source of
 * truth for student identity, so this DTO legitimately carries the identity
 * fields — this is NOT a student-facing DTO. Two things are deliberately absent
 * and can never be client-supplied:
 *   • studentId — the internal surrogate id is system-generated;
 *   • activationState — always starts PENDING (no login account is created).
 *
 * The matriculation number is accepted here (assigned by the institution) but
 * is validated for uniqueness by the service and the DB; it is never derived
 * from anything a STUDENT provides.
 */
export class CreateStudentDto {
  @IsString()
  @Length(3, 32)
  @Matches(/^[A-Za-z0-9/\-.]+$/, {
    message: 'Matriculation number contains invalid characters',
  })
  matriculationNumber!: string;

  @IsOptional()
  @IsString()
  @Length(3, 32)
  jambRegistrationNumber?: string;

  @IsString() @Length(1, 80) surname!: string;
  @IsString() @Length(1, 80) firstName!: string;
  @IsOptional() @IsString() @Length(1, 120) otherNames?: string;

  @IsISO8601() dateOfBirth!: string;

  @IsOptional() @IsEnum(Gender) gender?: Gender;

  @IsUUID() facultyId!: string;
  @IsUUID() departmentId!: string;
  @IsUUID() programmeId!: string;
  @IsUUID() admissionSessionId!: string;

  @IsOptional() @IsEnum(EntryMode) entryMode?: EntryMode;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1200)
  currentLevel!: number;

  /** Optional; defaults to the seeded ACTIVE status when omitted. */
  @IsOptional() @IsUUID() studentStatusId?: string;

  /** Contact of record (NOT identity). The verified OTP channel + login email
   *  of the account created at activation. Optional at creation but activation
   *  cannot deliver an OTP without an official email on file. */
  @IsOptional() @IsEmail() officialEmail?: string;
  @IsOptional() @IsString() @Length(4, 32) officialPhone?: string;
}

/**
 * Post-creation update for the NON-PROTECTED master-record fields only. The
 * protected identity fields are intentionally impossible to express here — they
 * change solely through an approved amendment (status endpoint / change-request
 * review), which the DB trigger independently enforces. Currently the only
 * freely-updatable field on the master record is the photo key.
 */
export class UpdateStudentDto {
  @IsOptional() @IsString() @Length(1, 256) photoKey?: string;
}

/** Admin-initiated academic-status change — applied as an approved amendment. */
export class ChangeStudentStatusDto {
  @IsUUID() studentStatusId!: string;
  @IsString() @Length(3, 500) reason!: string;
}

/** List/search/filter query for the admin student register. */
export class ListStudentsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() facultyId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() programmeId?: string;
  @IsOptional() @IsUUID() admissionSessionId?: string;
  @IsOptional() @IsUUID() studentStatusId?: string;

  @IsOptional()
  @IsEnum(['PENDING', 'ACTIVATED', 'LOCKED'])
  activationState?: 'PENDING' | 'ACTIVATED' | 'LOCKED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(1200)
  level?: number;
}
