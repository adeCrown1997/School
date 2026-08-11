import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Academic-structure DTOs.
 *
 * Two conventions carried over from structure.dto.ts:
 *   • codes are uppercase and normalized on write, so "csc101" and "CSC101" are
 *     the same course (the DB backs this with uq_course_code_ci);
 *   • no vocabulary is hardcoded here. Course categories and grade scales are
 *     rows, not enums, so an institution can name its own without a deployment
 *     (docs/02 configurability principle).
 */

/** Course codes are the university-wide identifier: CSC101, GST-102. */
const COURSE_CODE = /^[A-Z0-9-]{3,16}$/;
/** Config keys are lowercase dotted paths: academic.credit_policy. */
const CONFIG_KEY = /^[a-z][a-z0-9_.]{2,63}$/;

// --- Courses ---------------------------------------------------------------

export class CreateCourseDto {
  @Matches(COURSE_CODE, { message: 'Code must be 3-16 uppercase letters/digits/dashes' })
  code!: string;

  @IsString() @Length(3, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;

  /** Credit units are COPIED onto a registration line at commit (INV-6), so a
   *  later change here never silently re-weights a past registration. */
  @IsInt() @Min(0) @Max(60) creditUnits!: number;

  /** Nominal level (100, 200, ...). Not a rigid enum: some programmes teach a
   *  500-level course to 400-level students, which is a curriculum decision. */
  @IsInt() @Min(0) @Max(1200) level!: number;

  @IsOptional() @IsUUID() categoryId?: string;

  /** Null means university-wide (a GST course). Only a globally-scoped actor may
   *  create one, since it belongs to no single department. */
  @IsOptional() @IsUUID() departmentId?: string;
}

export class UpdateCourseDto {
  @IsOptional() @IsString() @Length(3, 200) title?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) creditUnits?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1200) level?: number;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
}

/** The code is deliberately absent from UpdateCourseDto: it is referenced by
 *  transcripts and prerequisite chains, so it is not a routine edit. */
export class SetCourseActiveDto {
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class AddPrerequisiteDto {
  @IsUUID() prerequisiteCourseId!: string;

  /** Optional minimum grade ("C"). Validated against the active scale's bands
   *  rather than a hardcoded letter list. */
  @IsOptional() @IsString() @Length(1, 4) minGrade?: string;
}

export class AddRelationshipDto {
  @IsUUID() relatedCourseId!: string;

  @IsString()
  @Matches(/^(EQUIVALENT|EXCLUSION|RECOMMENDED|ANTIREQUISITE)$/, {
    message: 'type must be EQUIVALENT, EXCLUSION, RECOMMENDED or ANTIREQUISITE',
  })
  type!: 'EQUIVALENT' | 'EXCLUSION' | 'RECOMMENDED' | 'ANTIREQUISITE';

  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

// --- Curriculum ------------------------------------------------------------

export class CreateCurriculumVersionDto {
  @IsUUID() programmeId!: string;
  @IsString() @Length(2, 120) name!: string;

  /** The admission cohort this version governs. A student is assessed against
   *  the version in force when they were admitted (INV-7), which is why this is
   *  a session and not a date. */
  @IsUUID() effectiveFromSessionId!: string;

  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class UpdateCurriculumVersionDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class CurriculumRequirementDto {
  @IsUUID() courseId!: string;
  @IsInt() @Min(0) @Max(1200) level!: number;
  @IsInt() @Min(1) @Max(6) semesterSequence!: number;

  @IsString()
  @Matches(/^(COMPULSORY|ELECTIVE)$/, { message: 'requirementType must be COMPULSORY or ELECTIVE' })
  requirementType!: 'COMPULSORY' | 'ELECTIVE';

  /** Overrides the course's own credit units for this programme only. Null keeps
   *  the course default — the common case. */
  @IsOptional() @IsInt() @Min(0) @Max(60) creditUnits?: number;

  /** Groups "choose 2 of these 5" electives. Requirements sharing a group are
   *  alternatives, not all required. */
  @IsOptional() @IsString() @Length(1, 60) electiveGroup?: string;
}

export class SetRequirementsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurriculumRequirementDto)
  requirements!: CurriculumRequirementDto[];
}

// --- Offerings -------------------------------------------------------------

export class CreateOfferingDto {
  @IsUUID() courseId!: string;
  @IsUUID() sessionId!: string;
  @IsUUID() semesterId!: string;

  /** The department TEACHING it, which may differ from the course's owner (a
   *  service course taught by Mathematics for Engineering). */
  @IsOptional() @IsUUID() departmentId?: string;

  /** Null means uncapped. Zero is a valid cap meaning "closed to registration"
   *  without deleting the offering. */
  @IsOptional() @IsInt() @Min(0) @Max(100000) capacity?: number;
}

export class UpdateOfferingDto {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) capacity?: number;

  @IsOptional()
  @IsString()
  @Matches(/^(DRAFT|OPEN|CLOSED)$/, { message: 'status must be DRAFT, OPEN or CLOSED' })
  status?: 'DRAFT' | 'OPEN' | 'CLOSED';
}

/** Mount a whole semester's timetable from a published curriculum, rather than
 *  one course at a time. The curriculum already states what must be taught. */
export class GenerateOfferingsDto {
  @IsUUID() curriculumVersionId!: string;
  @IsUUID() sessionId!: string;
  @IsUUID() semesterId!: string;

  /** Applied to every generated offering. Omit for uncapped. */
  @IsOptional() @IsInt() @Min(0) @Max(100000) capacity?: number;
}

// --- Academic configuration ------------------------------------------------

export class CreateCourseCategoryDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, {
    message: 'key must be uppercase letters, digits and underscores',
  })
  key!: string;

  @IsString() @Length(2, 80) label!: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class UpdateCourseCategoryDto {
  @IsOptional() @IsString() @Length(2, 80) label?: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class GradeBandDto {
  @IsString() @Length(1, 4) grade!: string;

  /** Percentages, inclusive at both ends. Decimal because a boundary of 39.5
   *  is a real institutional choice. */
  @IsNumber() @Min(0) @Max(100) minScore!: number;
  @IsNumber() @Min(0) @Max(100) maxScore!: number;

  /** Grade point (5.00, 4.00, ...). The maximum is not fixed at 5: a 4-point
   *  scale is equally valid, which is why the scale is data. */
  @IsNumber() @Min(0) @Max(10) gradePoint!: number;

  @IsOptional() @IsInt() @Min(0) @Max(99) sortOrder?: number;
}

export class CreateGradeScaleDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, { message: 'key must be uppercase' }) key!: string;
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsString() @Length(0, 500) description?: string;

  /** Bands are supplied WITH the scale: a scale with no bands cannot grade
   *  anything, and creating one in two steps invites exactly that state. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands!: GradeBandDto[];
}

export class UpdateGradeScaleBandsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeBandDto)
  bands!: GradeBandDto[];
}

export class SetConfigDto {
  @Matches(CONFIG_KEY, { message: 'key must be a lowercase dotted path' }) key!: string;

  /** Deliberately untyped: the whole point of SystemConfig is that policies are
   *  data. The service validates the shape per known key. */
  value!: unknown;

  @IsOptional() @IsString() @Length(0, 500) description?: string;
}

/** Min/max registrable units per semester — enforced at registration COMMIT
 *  (INV-8), not while a draft is being edited. */
export class CreditPolicyDto {
  @IsInt() @Min(0) @Max(60) minUnits!: number;
  @IsInt() @Min(1) @Max(60) maxUnits!: number;
}

// --- Query params ----------------------------------------------------------
// Query strings arrive as strings, so numeric and boolean filters need coercing
// before validation — without it `level=100` fails @IsInt.

/**
 * Coerce a query-string boolean.
 *
 * NOT `@Type(() => Boolean)`: that calls Boolean("false"), which is `true`, so
 * `?includeInactive=false` would silently mean the opposite of what it says.
 * Only the recognised true-ish spellings count as true.
 */
const BooleanQuery = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;
    const v = String(value).trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return value; // let @IsBoolean reject anything else, rather than guessing
  });

export class ListCoursesQueryDto {
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1200) level?: number;
  @IsOptional() @IsString() @Length(1, 100) q?: string;

  /** Inactive courses are hidden by default: the catalogue is mostly read by
   *  people choosing what to register for, and a retired course is noise. */
  @IsOptional() @BooleanQuery() @IsBoolean() includeInactive?: boolean;
}

export class ListCurriculumQueryDto {
  @IsOptional() @IsUUID() programmeId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(DRAFT|PUBLISHED|ARCHIVED)$/, {
    message: 'status must be DRAFT, PUBLISHED or ARCHIVED',
  })
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

export class ListOfferingsQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
  @IsOptional() @IsUUID() courseId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsString() @Length(1, 100) q?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(DRAFT|OPEN|CLOSED)$/, { message: 'status must be DRAFT, OPEN or CLOSED' })
  status?: 'DRAFT' | 'OPEN' | 'CLOSED';
}

export class IncludeInactiveQueryDto {
  @IsOptional() @BooleanQuery() @IsBoolean() includeInactive?: boolean;
}
