import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { PrismaService } from '../prisma/prisma.service';
import { PaginationQueryDto, paginatedResponse } from '../common/pagination';

/** Read-only audit log access, gated by audit.view. */
@Controller('admin/audit')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  async list(@Query() q: PaginationQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = q.search
      ? {
          OR: [
            { action: { contains: q.search, mode: 'insensitive' as const } },
            { entityType: { contains: q.search, mode: 'insensitive' as const } },
            { actorLabel: { contains: q.search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    // BigInt id → string for JSON safety.
    const items = rows.map((r) => ({ ...r, id: r.id.toString() }));
    return paginatedResponse({ items, page, pageSize, total });
  }
}
