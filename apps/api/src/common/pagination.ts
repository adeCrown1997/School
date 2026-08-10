import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Standard pagination + search query params. Bounds are enforced so a client
 * can never request an unbounded page (protects the DB and the wire).
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortDir?: 'asc' | 'desc';
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Build the { ok, data, meta } envelope for a paginated result. */
export function paginatedResponse<T>(result: Paginated<T>) {
  return {
    ok: true as const,
    data: result.items,
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
    },
  };
}

/** Clamp/normalize sort direction to a safe value. */
export function sortDirection(dir?: string): 'asc' | 'desc' {
  return dir === 'desc' ? 'desc' : 'asc';
}
