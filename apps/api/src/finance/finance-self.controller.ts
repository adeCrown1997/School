import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { LedgerService } from './ledger.service';
import { WaiverService } from './waiver.service';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Student-facing finance under /api/v1/me/finance. Authenticated-only; authority
 * is OWNERSHIP (the principal's linked studentRecordId), the same posture as
 * /me/results and /me/registration. A student sees only their own invoices,
 * payments, waivers and clearance — never another's.
 */
@Controller('me/finance')
@UseGuards(JwtAuthGuard)
export class FinanceSelfController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly waivers: WaiverService,
    private readonly invoices: InvoiceService,
    private readonly prisma: PrismaService,
  ) {}

  /** Everything a student needs on one screen: balances, invoices, clearance. */
  @Get()
  async ownFinance(@CurrentUser() user: AuthPrincipal, @Query('sessionId') sessionId?: string) {
    const studentRecordId = assertStudentPrincipal(user);
    const view = await this.ledger.studentLedger(studentRecordId, sessionId);

    // Attach a clearance verdict per distinct invoiced session so the student
    // sees exactly where they stand, not just raw figures.
    const sessionIds = [
      ...new Set(view.invoices.map((i) => i.session?.id).filter((s): s is string => Boolean(s))),
    ];
    const clearances = await Promise.all(
      sessionIds.map(async (sid) => {
        const verdict = await this.ledger.clearance(studentRecordId, sid);
        const session = await this.prisma.academicSession.findUnique({
          where: { id: sid },
          select: { id: true, name: true },
        });
        return {
          sessionId: sid,
          sessionName: session?.name ?? null,
          invoiced: verdict.invoiced,
          cleared: verdict.cleared,
          billed: verdict.billed.toString(),
          covered: verdict.covered.toString(),
          shortfall: verdict.shortfall.toString(),
        };
      }),
    );

    return ok({ ...view, clearances });
  }

  /** One of the caller's invoices with lines + payment history. */
  @Get('invoices/:id')
  async ownInvoice(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const studentRecordId = assertStudentPrincipal(user);
    const invoice = await this.invoices.get(id);
    if (invoice.student.id !== studentRecordId) {
      // Non-owner 404, not 403: never confirm another student's invoice exists.
      throw new NotFoundException('Invoice not found');
    }
    return ok(invoice);
  }

  /** The caller's loan clearances (provider, reference, amount, validity). */
  @Get('loans')
  async ownLoans(@CurrentUser() user: AuthPrincipal) {
    const studentRecordId = assertStudentPrincipal(user);
    return ok(await this.waivers.listLoanClearances(studentRecordId));
  }
}

function assertStudentPrincipal(user: AuthPrincipal): string {
  if (!user.studentRecordId) {
    throw new ForbiddenException('This endpoint is only available to an activated student account');
  }
  return user.studentRecordId;
}
