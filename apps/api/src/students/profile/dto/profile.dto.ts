import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination';

/**
 * The set of PROTECTED identity fields a STUDENT may request a correction to via
 * self-service. Deliberately narrow: personal-identity attributes that can be
 * legitimately wrong at data-entry and are backed by documents (birth cert,
 * admission letter). Academic placement/progression fields (faculty, department,
 * programme, level, status, session, entry mode) are NOT here — those are
 * administrative actions, never a student-initiated "correct my details".
 * studentId + matriculationNumber are never amendable at all.
 */
export const STUDENT_CORRECTABLE_FIELDS = [
  'surname',
  'firstName',
  'otherNames',
  'dateOfBirth',
  'gender',
  'jambRegistrationNumber',
] as const;

export type StudentCorrectableField = (typeof STUDENT_CORRECTABLE_FIELDS)[number];

/**
 * Update the student's OWN contact profile (Class S — non-identity data held in
 * StudentProfile, freely student-editable). None of these fields touch the
 * protected master record. All optional; only supplied keys are written.
 */
export class UpdateOwnProfileDto {
  @IsOptional() @IsString() @Length(4, 32) phone?: string;
  @IsOptional() @IsEmail() personalEmail?: string;
  @IsOptional() @IsString() @Length(1, 200) addressLine?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsString() @Length(1, 80) state?: string;
  @IsOptional() @IsString() @Length(1, 80) country?: string;
  @IsOptional() @IsString() @Length(1, 120) emergencyContactName?: string;
  @IsOptional() @IsString() @Length(4, 32) emergencyContactPhone?: string;
  @IsOptional() @IsString() @Length(2, 60) emergencyContactRelation?: string;
}

/**
 * A student's request to correct a protected identity field. The requested value
 * is captured as text and only APPLIED (routed through the amendment function)
 * when a Registry officer approves it — never on submission.
 */
export class CreateChangeRequestDto {
  @IsIn(STUDENT_CORRECTABLE_FIELDS as unknown as string[])
  fieldKey!: StudentCorrectableField;

  @IsString() @Length(1, 200) requestedValue!: string;

  @IsString() @Length(5, 500) reason!: string;

  /** Object-storage key of a supporting document (uploaded separately). */
  @IsOptional() @IsString() @Length(1, 256) documentKey?: string;
}

/** Registry decision on a pending change request. */
export class ReviewChangeRequestDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @Length(1, 500) reviewNote?: string;
}

/** Registry list/filter query over change requests. */
export class ListChangeRequestsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

  @IsOptional() @IsUUID() studentRecordId?: string;
  @IsOptional() @IsString() fieldKey?: string;
}
