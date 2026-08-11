import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StructureModule } from '../structure/structure.module';
import { CoursesService } from './courses.service';
import { CurriculumService } from './curriculum.service';
import { OfferingsService } from './offerings.service';
import { AcademicConfigService } from './academic-config.service';
import { AcademicsController } from './academics.controller';

/**
 * Academic structure module: course catalogue, curriculum versions, offerings
 * and academic configuration.
 *
 * StructureModule supplies resolveDepartmentLocation, which every scope check
 * needs to turn a department id into the (faculty, department) pair a grant is
 * measured against. AuthModule is imported because the controller's guards are
 * instantiated in this module's injector and need JwtService.
 *
 * The services are exported for the phases that build on them: registration
 * reads offerings and the credit policy, and results read the grade scales.
 */
@Module({
  imports: [AuthModule, StructureModule],
  providers: [CoursesService, CurriculumService, OfferingsService, AcademicConfigService],
  controllers: [AcademicsController],
  exports: [CoursesService, CurriculumService, OfferingsService, AcademicConfigService],
})
export class AcademicsModule {}
