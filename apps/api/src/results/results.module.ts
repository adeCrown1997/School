import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StructureModule } from '../structure/structure.module';
import { AssessmentService } from './assessment.service';
import { ScoreService } from './score.service';
import { ResultBatchService } from './result-batch.service';
import { WithholdingService } from './withholding.service';
import { ResultsSelfService } from './results-self.service';
import { ResultsController } from './results.controller';
import { ResultsSelfController } from './results-self.controller';

/**
 * Results module (docs/03 §10).
 *
 * Five services mirror the five authorities of the pipeline, and the permission
 * keys on the routes are what keep them separate end-to-end:
 *   AssessmentService   — HOD-owned weightings (INV-11)
 *   ScoreService        — lecturer-owned raw scores (INV-10 both directions)
 *   ResultBatchService  — approve → ratify → dual-control publish (INV-12/13)
 *   WithholdingService  — explicit, reasoned result blocks (§10.7)
 *   ResultsSelfService  — the student's OWN published view (ownership, not perms)
 *
 * StructureModule supplies resolveDepartmentLocation for the scope checks; the
 * exports exist so later phases (exams gating, progression, transcripts) read
 * grades through one published surface instead of re-querying the tables.
 */
@Module({
  imports: [AuthModule, StructureModule],
  providers: [
    AssessmentService,
    ScoreService,
    ResultBatchService,
    WithholdingService,
    ResultsSelfService,
  ],
  controllers: [ResultsController, ResultsSelfController],
  exports: [ResultBatchService, WithholdingService, ResultsSelfService],
})
export class ResultsModule {}
