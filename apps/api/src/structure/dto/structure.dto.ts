import {
  IsBoolean,
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

/** Codes are short, uppercase, alphanumeric (+dash) — stable identifiers. */
const CODE = /^[A-Z0-9-]{2,16}$/;

export class CreateFacultyDto {
  @IsUUID() universityId!: string;
  @IsString() @Length(2, 120) name!: string;
  @Matches(CODE, { message: 'Code must be 2-16 uppercase letters/digits' }) code!: string;
}

export class CreateDepartmentDto {
  @IsUUID() facultyId!: string;
  @IsString() @Length(2, 120) name!: string;
  @Matches(CODE) code!: string;
}

export class CreateProgrammeDto {
  @IsUUID() departmentId!: string;
  @IsString() @Length(2, 150) name!: string;
  @Matches(CODE) code!: string;
  @IsString() @Length(1, 40) award!: string;
  @IsInt() @Min(1) @Max(10) durationYears!: number;
  @IsOptional() @IsString() studyMode?: 'FULL_TIME' | 'PART_TIME' | 'SANDWICH';
}

export class CreateSessionDto {
  @Matches(/^\d{4}\/\d{4}$/, { message: 'Session must look like 2024/2025' }) name!: string;
  @IsISO8601() startDate!: string;
  @IsISO8601() endDate!: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

/**
 * A teaching period inside a session. The COUNT is not fixed by the system — an
 * institution running trimesters creates three — so `sequence` is just an
 * ordering integer, bounded only to catch typos. Dates are optional because a
 * semester is often created before its calendar is finalised.
 */
export class CreateSemesterDto {
  @IsUUID() sessionId!: string;
  @IsInt() @Min(1) @Max(6) sequence!: number;
  @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsISO8601() startDate?: string;
  @IsOptional() @IsISO8601() endDate?: string;
  @IsOptional() @IsBoolean() isCurrent?: boolean;
}

export class UpdateActiveFlagDto {
  @IsBoolean() isActive!: boolean;
}
