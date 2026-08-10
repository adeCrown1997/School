import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
import { StructureService } from './structure.service';
import {
  CreateDepartmentDto,
  CreateFacultyDto,
  CreateProgrammeDto,
  CreateSemesterDto,
  CreateSessionDto,
} from './dto/structure.dto';

/**
 * University-structure endpoints. Reads require structure.view (any staff);
 * writes require structure.manage. Everything is served from the DB so the web
 * app never hardcodes faculties/departments/programmes/sessions.
 */
@Controller('structure')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  @Get('tree')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  tree() {
    return this.structure.getTree();
  }

  @Get('faculties')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  faculties() {
    return this.structure.listFaculties();
  }

  @Get('departments')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  departments(@Query('facultyId') facultyId?: string) {
    return this.structure.listDepartments(facultyId);
  }

  @Get('programmes')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  programmes(@Query('departmentId') departmentId?: string) {
    return this.structure.listProgrammes(departmentId);
  }

  @Get('sessions')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  sessions() {
    return this.structure.listSessions();
  }

  /** Semesters are part of the university calendar, hence structure.* rather
   *  than a separate permission (see the permission catalog's description). */
  @Get('semesters')
  @RequirePermissions(PERMISSIONS.STRUCTURE_VIEW)
  semesters(@Query('sessionId') sessionId?: string) {
    return this.structure.listSemesters(sessionId);
  }

  @Post('faculties')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createFaculty(@Body() dto: CreateFacultyDto, @CurrentUser() user: AuthPrincipal) {
    return this.structure.createFaculty(dto, user);
  }

  @Post('departments')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createDepartment(@Body() dto: CreateDepartmentDto, @CurrentUser() user: AuthPrincipal) {
    return this.structure.createDepartment(dto, user);
  }

  @Post('programmes')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createProgramme(@Body() dto: CreateProgrammeDto, @CurrentUser() user: AuthPrincipal) {
    return this.structure.createProgramme(dto, user);
  }

  @Post('sessions')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthPrincipal) {
    return this.structure.createSession(dto, user);
  }

  @Post('sessions/:id/set-current')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  setCurrent(@Param('id') id: string, @CurrentUser() user: AuthPrincipal) {
    return this.structure.setCurrentSession(id, user);
  }

  @Post('semesters')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createSemester(@Body() dto: CreateSemesterDto, @CurrentUser() user: AuthPrincipal) {
    return this.structure.createSemester(dto, user);
  }

  @Post('semesters/:id/set-current')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  setCurrentSemester(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.structure.setCurrentSemester(id, user);
  }
}
