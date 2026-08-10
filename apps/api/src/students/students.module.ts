import { Module } from '@nestjs/common';
import { StructureModule } from '../structure/structure.module';
import { AuthModule } from '../auth/auth.module';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { IdGeneratorService } from './id-generator.service';
import { StudentImportService } from './import/student-import.service';
import { StudentImportController } from './import/student-import.controller';
import { ActivationService } from './activation/activation.service';
import { ActivationController } from './activation/activation.controller';
import { ProfileService } from './profile/profile.service';
import { StudentSelfController } from './profile/student-self.controller';
import { ChangeRequestController } from './profile/change-request.controller';

/**
 * Student master-record module. Depends on StructureModule for academic-
 * hierarchy validation and AuthModule for PasswordService (activation hashes
 * the new student password with the same argon2id policy as staff logins).
 * Exports StudentsService so the change-request module reuses the same
 * authoritative create/amend paths (single source of truth for identity
 * mutations). The bulk-import and activation services live here too so they
 * share StudentsService's insert path and the record lifecycle directly.
 */
@Module({
  imports: [StructureModule, AuthModule],
  providers: [
    StudentsService,
    IdGeneratorService,
    StudentImportService,
    ActivationService,
    ProfileService,
  ],
  controllers: [
    StudentsController,
    StudentImportController,
    ActivationController,
    StudentSelfController,
    ChangeRequestController,
  ],
  exports: [StudentsService, IdGeneratorService],
})
export class StudentsModule {}
