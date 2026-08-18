import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { AssessmentService } from './assessment.service';
import { ScoreService } from './score.service';
import { ResultBatchService } from './result-batch.service';
import { WithholdingService } from './withholding.service';
import { parseScoreSheet } from './score-import.parse';
import {
  CreateWithholdingDto,
  DecideResultBatchDto,
  ListResultBatchesQueryDto,
  ListWithholdingsQueryDto,
  PublishResultBatchDto,
  ReleaseWithholdingDto,
  SaveScoresDto,
  SetAssessmentComponentsDto,
  SubmitScoresDto,
} from './dto/results.dto';

/** Uploaded score sheet (multer memory storage — buffer kept in RAM, never disk). */
interface UploadedSheet {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

const sheetUploadOptions = {
  storage: memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
};

/**
 * STAFF result endpoints (docs/03 §10).
 *
 * The permission split IS the security model here: assessment weightings are
 * HOD-owned (§10.1, INV-11), raw score entry belongs to the allocated lecturer
 * (RESULTS_SCORE_MANAGE), approval is a staged chain (RESULTS_APPROVE), and
 * publication is dual-control (RESULTS_PUBLISH). A route that conflates two of
 * these keys would re-open the one-person-examination-board hole.
 */
@Controller('results')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ResultsController {
  constructor(
    private readonly assessment: AssessmentService,
    private readonly scores: ScoreService,
    private readonly batches: ResultBatchService,
    private readonly withholdings: WithholdingService,
  ) {}

  // --- Assessment structure (§10.1, HOD-owned) ------------------------------

  @Get('offerings/:offeringId/components')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  listComponents(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.assessment.listComponents(offeringId, user, PERMISSIONS.RESULTS_SCORE_MANAGE);
  }

  @Post('offerings/:offeringId/components')
  @RequirePermissions(PERMISSIONS.RESULTS_ASSESS_MANAGE)
  setComponents(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @Body() dto: SetAssessmentComponentsDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.assessment.setComponents(offeringId, dto, user);
  }

  // --- Score entry (§10.2) ----------------------------------------------------

  @Get('offerings/:offeringId/scores')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  scoreGrid(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.scores.getGrid(offeringId, user);
  }

  @Post('offerings/:offeringId/scores')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  saveScores(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @Body() dto: SaveScoresDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.scores.saveScores(offeringId, dto, user);
  }

  @Post('offerings/:offeringId/scores/submit')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  submitScores(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @Body() dto: SubmitScoresDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.scores.submitComponents(offeringId, dto, user);
  }

  // --- Score-sheet upload (§10.2) ----------------------------------------------

  /**
   * Preview a CSV/XLSX score sheet against the offering's assessment structure.
   * No writes — every invalid cell is reported per row, invalid rows are never
   * silently dropped. Sheet columns that are not components are listed, not
   * absorbed.
   */
  @Post('offerings/:offeringId/scores/import/preview')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  @UseInterceptors(FileInterceptor('file', sheetUploadOptions))
  async previewScoreSheet(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @UploadedFile() file: UploadedSheet | undefined,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.assertFile(file);
    const parsed = await parseScoreSheet(file!.buffer, file!.originalname, file!.mimetype);
    return this.scores.previewSheet(offeringId, parsed, user);
  }

  /**
   * Apply the previewed sheet: writes every valid cell as a DRAFT entry (the
   * same upsert as autosave — the explicit submit still promotes them).
   * All-or-nothing while any row is in error.
   */
  @Post('offerings/:offeringId/scores/import/apply')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  @UseInterceptors(FileInterceptor('file', sheetUploadOptions))
  async applyScoreSheet(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @UploadedFile() file: UploadedSheet | undefined,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.assertFile(file);
    const parsed = await parseScoreSheet(file!.buffer, file!.originalname, file!.mimetype);
    return this.scores.applySheet(offeringId, parsed, user);
  }

  private assertFile(file: UploadedSheet | undefined): void {
    if (!file || !file.buffer?.length) {
      throw new BadRequestException('Upload a .csv or .xlsx file in the "file" field');
    }
  }

  // --- Batches & approval (§10.4) --------------------------------------------

  @Get('batches')
  @RequirePermissions(PERMISSIONS.RESULTS_VIEW)
  listBatches(@Query() q: ListResultBatchesQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.batches.list(q, user);
  }

  /** Open (or fetch, idempotently) the batch for an offering — pins the scale. */
  @Post('offerings/:offeringId/batch')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  openBatch(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.batches.openBatch(offeringId, user);
  }

  @Get('batches/:id')
  @RequirePermissions(PERMISSIONS.RESULTS_VIEW)
  getBatch(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.batches.detail(id, user);
  }

  /**
   * The same batch, readable by whoever can ENTER its scores. The score-entry
   * screen shows the batch's lifecycle position (draft, awaiting approval, …),
   * and a lecturer holds score.manage but not results.view — the list remains
   * view-only. Scope-checked on score.manage exactly like the entry endpoints.
   */
  @Get('offerings/:offeringId/batch')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  batchForOffering(
    @Param('offeringId', new ParseUUIDPipe()) offeringId: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.batches.detailForOffering(offeringId, user);
  }

  @Get('batches/:id/compute')
  @RequirePermissions(PERMISSIONS.RESULTS_VIEW)
  computeBatch(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.batches.compute(id, user);
  }

  @Post('batches/:id/submit')
  @RequirePermissions(PERMISSIONS.RESULTS_SCORE_MANAGE)
  @HttpCode(200)
  submitBatch(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.batches.submit(id, user);
  }

  @Post('batches/:id/decision')
  @RequirePermissions(PERMISSIONS.RESULTS_APPROVE)
  @HttpCode(200)
  decideBatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideResultBatchDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.batches.decide(id, user, dto);
  }

  @Post('batches/:id/publish')
  @RequirePermissions(PERMISSIONS.RESULTS_PUBLISH)
  @HttpCode(200)
  publishBatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PublishResultBatchDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.batches.publish(id, user, dto);
  }

  // --- Withholdings (§10.7) ----------------------------------------------------

  @Get('withholdings')
  @RequirePermissions(PERMISSIONS.RESULTS_VIEW)
  listWithholdings(@Query() q: ListWithholdingsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.withholdings.list(q, user);
  }

  @Post('withholdings')
  @RequirePermissions(PERMISSIONS.RESULTS_WITHHOLD)
  createWithholding(@Body() dto: CreateWithholdingDto, @CurrentUser() user: AuthPrincipal) {
    return this.withholdings.create(dto, user);
  }

  @Post('withholdings/:id/release')
  @RequirePermissions(PERMISSIONS.RESULTS_WITHHOLD)
  @HttpCode(200)
  releaseWithholding(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReleaseWithholdingDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.withholdings.release(id, user, dto.note);
  }
}
