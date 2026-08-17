import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { paginatedResponse } from '../common/pagination';
import { FeeScheduleService } from './fee-schedule.service';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';
import { WaiverService } from './waiver.service';
import { ReconciliationService } from './reconciliation.service';
import { LedgerService } from './ledger.service';
import {
  CancelInvoiceDto,
  CancelWaiverDto,
  CreateFeeScheduleDto,
  CreateWaiverDto,
  DecideWaiverDto,
  GenerateInvoicesDto,
  IssueInvoiceDto,
  ListInvoicesQueryDto,
  ListWaiversQueryDto,
  RecordLoanClearanceDto,
  RecordPaymentDto,
  RecordReconciliationDto,
  ReplaceFeeItemsDto,
  ResolveReconciliationDto,
  ReversePaymentDto,
  UpdateFeeScheduleDto,
} from './dto/finance.dto';

/**
 * STAFF finance endpoints under /api/v1/finance (docs/03 §11).
 *
 * The permission split IS the security model: schedules (FINANCE_SCHEDULE_MANAGE),
 * invoices (FINANCE_INVOICE_MANAGE), posting/reversing money on the ledger
 * (FINANCE_PAYMENT_MANAGE), waivers & loan clearances (FINANCE_WAIVER_MANAGE),
 * and reconciliation (FINANCE_RECONCILE) are all separate grants, so no single
 * role can raise, waive AND post money. Viewing everything needs FINANCE_VIEW.
 */
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FinanceController {
  constructor(
    private readonly schedules: FeeScheduleService,
    private readonly invoices: InvoiceService,
    private readonly payments: PaymentService,
    private readonly waivers: WaiverService,
    private readonly reconciliations: ReconciliationService,
    private readonly ledger: LedgerService,
  ) {}

  // --- Overview -----------------------------------------------------------------

  @Get('overview')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  overview(@Query('sessionId') sessionId: string | undefined) {
    return this.ledger.overview(sessionId);
  }

  // --- Fee schedules -------------------------------------------------------------

  @Get('schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listSchedules(@Query('includeInactive') includeInactive: string | undefined) {
    return this.schedules.list(includeInactive === 'true');
  }

  @Get('schedules/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  getSchedule(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.schedules.get(id);
  }

  @Post('schedules')
  @RequirePermissions(PERMISSIONS.FINANCE_SCHEDULE_MANAGE)
  createSchedule(@Body() dto: CreateFeeScheduleDto, @CurrentUser() user: AuthPrincipal) {
    return this.schedules.create(dto, user);
  }

  @HttpCode(200)
  @Post('schedules/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_SCHEDULE_MANAGE)
  updateSchedule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFeeScheduleDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.schedules.update(id, dto, user);
  }

  /** Whole-set replacement of a schedule's fee items (frozen once invoiced). */
  @HttpCode(200)
  @Post('schedules/:id/items')
  @RequirePermissions(PERMISSIONS.FINANCE_SCHEDULE_MANAGE)
  replaceItems(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReplaceFeeItemsDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.schedules.updateItems(id, dto.items, user);
  }

  // --- Invoices -------------------------------------------------------------------

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  async listInvoices(
    @Query() q: ListInvoicesQueryDto,
    @CurrentUser() user: AuthPrincipal,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const size = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const { items, total } = await this.invoices.list(q, user, pageNum, size);
    return paginatedResponse({ items, page: pageNum, pageSize: size, total });
  }

  @Get('invoices/:id')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  getInvoice(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.get(id);
  }

  @Post('invoices/generate')
  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_MANAGE)
  generateInvoices(@Body() dto: GenerateInvoicesDto, @CurrentUser() user: AuthPrincipal) {
    return this.invoices.generate(dto, user);
  }

  @HttpCode(200)
  @Post('invoices/:id/issue')
  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_MANAGE)
  issueInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: IssueInvoiceDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.invoices.issue(id, dto, user);
  }

  @HttpCode(200)
  @Post('invoices/:id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCE_INVOICE_MANAGE)
  cancelInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelInvoiceDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.invoices.cancel(id, user, dto.reason);
  }

  // --- Payments --------------------------------------------------------------------

  @Get('payments')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listPayments(
    @Query('studentRecordId') studentRecordId?: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    return this.payments.listIntents({ studentRecordId, invoiceId });
  }

  @Post('payments')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENT_MANAGE)
  recordPayment(@Body() dto: RecordPaymentDto, @CurrentUser() user: AuthPrincipal) {
    return this.payments.record(dto, user);
  }

  @HttpCode(200)
  @Post('payments/reverse')
  @RequirePermissions(PERMISSIONS.FINANCE_PAYMENT_MANAGE)
  reversePayment(@Body() dto: ReversePaymentDto, @CurrentUser() user: AuthPrincipal) {
    return this.payments.reverse(dto, user);
  }

  // --- Waivers & loan clearances -----------------------------------------------------

  @Get('waivers')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listWaivers(@Query() q: ListWaiversQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.waivers.list(q, user);
  }

  @Post('waivers')
  @RequirePermissions(PERMISSIONS.FINANCE_WAIVER_MANAGE)
  createWaiver(@Body() dto: CreateWaiverDto, @CurrentUser() user: AuthPrincipal) {
    return this.waivers.create(dto, user);
  }

  @HttpCode(200)
  @Post('waivers/:id/decide')
  @RequirePermissions(PERMISSIONS.FINANCE_WAIVER_MANAGE)
  decideWaiver(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideWaiverDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.waivers.decide(id, dto, user);
  }

  @HttpCode(200)
  @Post('waivers/:id/cancel')
  @RequirePermissions(PERMISSIONS.FINANCE_WAIVER_MANAGE)
  cancelWaiver(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelWaiverDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.waivers.cancel(id, user, dto.reason);
  }

  @Get('loans')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listLoans(@Query('studentRecordId') studentRecordId?: string) {
    return this.waivers.listLoanClearances(studentRecordId);
  }

  @Post('loans')
  @RequirePermissions(PERMISSIONS.FINANCE_WAIVER_MANAGE)
  recordLoan(@Body() dto: RecordLoanClearanceDto, @CurrentUser() user: AuthPrincipal) {
    return this.waivers.recordLoanClearance(dto, user);
  }

  @HttpCode(200)
  @Post('loans/:id/approve')
  @RequirePermissions(PERMISSIONS.FINANCE_WAIVER_MANAGE)
  approveLoan(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.waivers.approveLoanClearance(id, user);
  }

  // --- Student ledger ----------------------------------------------------------------

  @Get('students/:studentRecordId/ledger')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  studentLedger(
    @Param('studentRecordId', new ParseUUIDPipe()) studentRecordId: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.ledger.studentLedger(studentRecordId, sessionId);
  }

  @Get('students/:studentRecordId/clearance')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  clearance(
    @Param('studentRecordId', new ParseUUIDPipe()) studentRecordId: string,
    @Query('sessionId') sessionId: string,
  ) {
    return this.ledger.clearanceFor(studentRecordId, sessionId);
  }

  // --- Reconciliation (§11.5) -----------------------------------------------------------

  @Get('reconciliations')
  @RequirePermissions(PERMISSIONS.FINANCE_VIEW)
  listReconciliations(@Query('provider') provider?: string) {
    return this.reconciliations.list(provider);
  }

  @Post('reconciliations')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILE)
  recordReconciliation(@Body() dto: RecordReconciliationDto, @CurrentUser() user: AuthPrincipal) {
    return this.reconciliations.record(dto, user);
  }

  @HttpCode(200)
  @Post('reconciliations/:id/resolve')
  @RequirePermissions(PERMISSIONS.FINANCE_RECONCILE)
  resolveReconciliation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveReconciliationDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.reconciliations.resolve(id, user, dto.notes);
  }
}
