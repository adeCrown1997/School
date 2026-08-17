import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeeScheduleService } from './fee-schedule.service';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';
import { WaiverService } from './waiver.service';
import { ReconciliationService } from './reconciliation.service';
import { LedgerService } from './ledger.service';
import { FinanceController } from './finance.controller';
import { FinanceSelfController } from './finance-self.controller';

/**
 * Finance module (docs/03 §11).
 *
 * Six services mirror the six authorities of the money pipeline, and the
 * permission keys on the routes keep them apart end-to-end:
 *   FeeScheduleService      — fee structure per programme/session (§11.2)
 *   InvoiceService          — bill generation, issue, cancellation
 *   PaymentService          — posting & reversal on the ledger (INV-14/15)
 *   WaiverService           — waivers & loan clearances with SOD approval
 *   ReconciliationService   — settlement vs ledger (§11.5)
 *   LedgerService           — the DERIVED read side (balances, clearance)
 *
 * LedgerService is exported because registration's fee-clearance gate (and the
 * exams module's eligibility check) must ask the same derived question
 * (INV-16) through one surface instead of re-summing tables.
 */
@Module({
  imports: [AuthModule],
  providers: [
    FeeScheduleService,
    InvoiceService,
    PaymentService,
    WaiverService,
    ReconciliationService,
    LedgerService,
  ],
  controllers: [FinanceController, FinanceSelfController],
  exports: [LedgerService],
})
export class FinanceModule {}
