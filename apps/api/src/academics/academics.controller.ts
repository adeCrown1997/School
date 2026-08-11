import {
  Body,
  Controller,
  Delete,
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
import { CoursesService } from './courses.service';
import { CurriculumService } from './curriculum.service';
import { OfferingsService } from './offerings.service';
import { AcademicConfigService } from './academic-config.service';
import {
  AddPrerequisiteDto,
  AddRelationshipDto,
  CreateCourseCategoryDto,
  CreateCourseDto,
  CreateCurriculumVersionDto,
  CreateGradeScaleDto,
  CreateOfferingDto,
  CreditPolicyDto,
  GenerateOfferingsDto,
  IncludeInactiveQueryDto,
  ListCoursesQueryDto,
  ListCurriculumQueryDto,
  ListOfferingsQueryDto,
  SetCourseActiveDto,
  SetRequirementsDto,
  UpdateCourseCategoryDto,
  UpdateCourseDto,
  UpdateCurriculumVersionDto,
  UpdateGradeScaleBandsDto,
  UpdateOfferingDto,
} from './dto/academics.dto';

/**
 * Academic-structure endpoints: course catalogue, curriculum versions, course
 * offerings, and academic configuration.
 *
 * Every route names the permission it needs. The view/manage split is
 * deliberate and follows the permission catalog: reading the catalogue is
 * ordinary staff work, while authoring it is not, and publishing a curriculum is
 * a third authority again (a department may draft what only a dean may enact).
 *
 * Scope narrowing happens in the services, not here — the controller cannot
 * know which department owns the row being edited until it has been loaded.
 */
@Controller('academics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AcademicsController {
  constructor(
    private readonly courses: CoursesService,
    private readonly curriculum: CurriculumService,
    private readonly offerings: OfferingsService,
    private readonly config: AcademicConfigService,
  ) {}

  // --- Courses ------------------------------------------------------------

  @Get('courses')
  @RequirePermissions(PERMISSIONS.COURSES_VIEW)
  listCourses(@Query() q: ListCoursesQueryDto) {
    return this.courses.list(q);
  }

  @Get('courses/:id')
  @RequirePermissions(PERMISSIONS.COURSES_VIEW)
  getCourse(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.courses.get(id);
  }

  @Post('courses')
  @RequirePermissions(PERMISSIONS.COURSES_CREATE)
  createCourse(@Body() dto: CreateCourseDto, @CurrentUser() user: AuthPrincipal) {
    return this.courses.create(dto, user);
  }

  @Patch('courses/:id')
  @RequirePermissions(PERMISSIONS.COURSES_UPDATE)
  updateCourse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.update(id, dto, user);
  }

  /** Deactivation rather than deletion: transcripts reference courses forever. */
  @Post('courses/:id/active')
  @RequirePermissions(PERMISSIONS.COURSES_DEACTIVATE)
  setCourseActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetCourseActiveDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.setActive(id, dto, user);
  }

  @Post('courses/:id/prerequisites')
  @RequirePermissions(PERMISSIONS.COURSES_UPDATE)
  addPrerequisite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddPrerequisiteDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.addPrerequisite(id, dto, user);
  }

  @Delete('courses/:id/prerequisites/:prerequisiteId')
  @RequirePermissions(PERMISSIONS.COURSES_UPDATE)
  removePrerequisite(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('prerequisiteId', new ParseUUIDPipe()) prerequisiteId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.removePrerequisite(id, prerequisiteId, user);
  }

  @Post('courses/:id/relationships')
  @RequirePermissions(PERMISSIONS.COURSES_UPDATE)
  addRelationship(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddRelationshipDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.addRelationship(id, dto, user);
  }

  @Delete('courses/:id/relationships/:relationshipId')
  @RequirePermissions(PERMISSIONS.COURSES_UPDATE)
  removeRelationship(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('relationshipId', new ParseUUIDPipe()) relationshipId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.courses.removeRelationship(id, relationshipId, user);
  }

  // --- Curriculum ---------------------------------------------------------

  @Get('curriculum')
  @RequirePermissions(PERMISSIONS.CURRICULUM_VIEW)
  listCurriculum(@Query() q: ListCurriculumQueryDto) {
    return this.curriculum.list(q);
  }

  @Get('curriculum/:id')
  @RequirePermissions(PERMISSIONS.CURRICULUM_VIEW)
  getCurriculum(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.curriculum.get(id);
  }

  @Post('curriculum')
  @RequirePermissions(PERMISSIONS.CURRICULUM_MANAGE)
  createCurriculum(@Body() dto: CreateCurriculumVersionDto, @CurrentUser() user: AuthPrincipal) {
    return this.curriculum.create(dto, user);
  }

  @Patch('curriculum/:id')
  @RequirePermissions(PERMISSIONS.CURRICULUM_MANAGE)
  updateCurriculum(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCurriculumVersionDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.curriculum.update(id, dto, user);
  }

  /** The requirement set is replaced wholesale — see the service for why a
   *  sequence of add/remove calls would leave the version transiently invalid. */
  @Post('curriculum/:id/requirements')
  @RequirePermissions(PERMISSIONS.CURRICULUM_MANAGE)
  setRequirements(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SetRequirementsDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.curriculum.setRequirements(id, dto, user);
  }

  @Post('curriculum/:id/publish')
  @RequirePermissions(PERMISSIONS.CURRICULUM_PUBLISH)
  publishCurriculum(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.curriculum.publish(id, user);
  }

  @Post('curriculum/:id/archive')
  @RequirePermissions(PERMISSIONS.CURRICULUM_PUBLISH)
  archiveCurriculum(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.curriculum.archive(id, user);
  }

  // --- Offerings ----------------------------------------------------------

  @Get('offerings')
  @RequirePermissions(PERMISSIONS.OFFERINGS_VIEW)
  listOfferings(@Query() q: ListOfferingsQueryDto) {
    return this.offerings.list(q);
  }

  @Get('offerings/:id')
  @RequirePermissions(PERMISSIONS.OFFERINGS_VIEW)
  getOffering(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.offerings.get(id);
  }

  @Post('offerings')
  @RequirePermissions(PERMISSIONS.OFFERINGS_MANAGE)
  createOffering(@Body() dto: CreateOfferingDto, @CurrentUser() user: AuthPrincipal) {
    return this.offerings.create(dto, user);
  }

  @Patch('offerings/:id')
  @RequirePermissions(PERMISSIONS.OFFERINGS_MANAGE)
  updateOffering(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOfferingDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.offerings.update(id, dto, user);
  }

  /** Mount a semester's timetable from a published curriculum. Idempotent:
   *  existing offerings are reported, not overwritten. */
  @Post('offerings/generate')
  @RequirePermissions(PERMISSIONS.OFFERINGS_MANAGE)
  generateOfferings(@Body() dto: GenerateOfferingsDto, @CurrentUser() user: AuthPrincipal) {
    return this.offerings.generateFromCurriculum(dto, user);
  }

  @Delete('offerings/:id')
  @RequirePermissions(PERMISSIONS.OFFERINGS_MANAGE)
  removeOffering(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.offerings.remove(id, user);
  }

  // --- Configuration: course categories -----------------------------------

  /**
   * Categories are readable with COURSES_VIEW as well as the config permission:
   * the course form needs the list to render its dropdown, and a course author
   * is not necessarily an academic-configuration administrator.
   */
  @Get('categories')
  @RequirePermissions(PERMISSIONS.COURSES_VIEW)
  listCategories(@Query() q: IncludeInactiveQueryDto) {
    return this.config.listCategories(q.includeInactive ?? false);
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  createCategory(@Body() dto: CreateCourseCategoryDto, @CurrentUser() user: AuthPrincipal) {
    return this.config.createCategory(dto, user);
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  updateCategory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCourseCategoryDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.config.updateCategory(id, dto, user);
  }

  // --- Configuration: grade scales ----------------------------------------

  @Get('grade-scales')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_VIEW)
  listScales(@Query() q: IncludeInactiveQueryDto) {
    return this.config.listScales(q.includeInactive ?? false);
  }

  @Get('grade-scales/:id')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_VIEW)
  getScale(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.config.getScale(id);
  }

  @Post('grade-scales')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  createScale(@Body() dto: CreateGradeScaleDto, @CurrentUser() user: AuthPrincipal) {
    return this.config.createScale(dto, user);
  }

  @Post('grade-scales/:id/bands')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  replaceBands(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGradeScaleBandsDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.config.replaceBands(id, dto, user);
  }

  @Post('grade-scales/:id/set-default')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  setDefaultScale(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.config.setDefaultScale(id, user);
  }

  // --- Configuration: credit policy ---------------------------------------

  @Get('credit-policy')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_VIEW)
  getCreditPolicy() {
    return this.config.getCreditPolicy();
  }

  @Post('credit-policy')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  setCreditPolicy(@Body() dto: CreditPolicyDto, @CurrentUser() user: AuthPrincipal) {
    return this.config.setCreditPolicy(dto, user);
  }
}
