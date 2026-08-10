import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { ScopeType } from '@prisma/client';
import { PaginationQueryDto } from '../../common/pagination';

/**
 * Admin user-management DTOs. These provision and manage STAFF accounts only —
 * there is deliberately no path here to create a STUDENT login (students obtain
 * a login solely through the activation ceremony against a pre-existing record),
 * and no field by which an admin could attach a studentRecordId.
 */
export class CreateStaffDto {
  @IsEmail() email!: string;

  @IsString() @Length(2, 160) fullName!: string;

  /**
   * A TEMPORARY password the new user must change on first login. Strength is
   * enforced server-side by PasswordService in addition to this length bound.
   */
  @IsString() @Length(8, 128) temporaryPassword!: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @Length(2, 160) fullName?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class SetActiveDto {
  @IsBoolean() isActive!: boolean;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional() @IsBoolean() @Type(() => Boolean) isActive?: boolean;
  /** Filter to users holding a given role key (e.g. REGISTRY_OFFICER). */
  @IsOptional() @IsString() roleKey?: string;
}

/**
 * A scoped role assignment. Scope is NEVER encoded in the role — it is supplied
 * here as (scopeType + the matching id). GLOBAL leaves all ids null. The service
 * enforces (a) grant-authority (the actor may only assign a role whose
 * permissions are a subset of their own) and (b) that the requested scope is no
 * broader than the role's scopeKind.
 */
export class AssignRoleDto {
  @IsUUID() roleId!: string;

  @IsEnum(ScopeType) scopeType!: ScopeType;

  @IsOptional() @IsUUID() facultyId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() programmeId?: string;
}

/** Create a custom (non-system) role. Grant-authority applies to its permissions. */
export class CreateRoleDto {
  @IsString() @Length(2, 64) key!: string;
  @IsString() @Length(2, 120) name!: string;
  @IsString() @Length(0, 500) description = '';
  @IsEnum(ScopeType) scopeKind!: ScopeType;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  permissionKeys!: string[];
}

/** Wrapper kept for symmetry / future nested validation needs. */
export class AssignRolesWrapperDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AssignRoleDto)
  assignments!: AssignRoleDto[];
}
