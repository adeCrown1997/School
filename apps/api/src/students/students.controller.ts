import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { paginatedResponse } from '../common/pagination';
import { StudentsService } from './students.service';
import {
  ChangeStudentStatusDto,
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from './dto/students.dto';

/**
 * Official student master-record endpoints. EVERY route is permission-guarded
 * independently (defense in depth — never relies on the UI hiding anything),
 * and every write additionally enforces the actor's faculty/department scope in
 * the service. There is deliberately NO endpoint that lets a student create or
 * self-edit their identity: students reach a record only through the separate
 * activation flow, and identity corrections go through the change-request +
 * amendment path.
 */
@Controller('students')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @RequirePermissions(PERMISSIONS.STUDENTS_CREATE)
  async create(@Body() dto: CreateStudentDto, @CurrentUser() user: AuthPrincipal) {
    return this.students.create(dto, user);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  async list(@Query() query: ListStudentsQueryDto, @CurrentUser() user: AuthPrincipal) {
    const result = await this.students.list(query, user);
    return paginatedResponse(result);
  }

  /**
   * Configurable student-status vocabulary. Declared BEFORE the ':id' route so
   * the literal path is not captured as a uuid param. Any staff who may view
   * students may read the status list (needed to render filters + the
   * status-change form from the DB rather than a hardcoded list).
   */
  @Get('statuses')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  async statuses() {
    return this.students.listStatuses();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_VIEW)
  async getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.students.getById(id, user);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.STUDENTS_UPDATE)
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.students.updateNonProtected(id, dto, user);
  }

  @Post(':id/status')
  @RequirePermissions(PERMISSIONS.STUDENTS_STATUS)
  async changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangeStudentStatusDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.students.changeStatus(id, dto, user);
  }
}
