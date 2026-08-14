import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(@Inject(PaymentService) private readonly payments: PaymentService) {}

  onModuleInit(): void {
    if (process.env.PAYMENT_RECONCILIATION_DISABLED === 'true') return;
    const configured = Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS ?? '5000');
    const intervalMs = Number.isFinite(configured)
      ? Math.max(1000, Math.min(configured, 60_000))
      : 5000;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.payments.failStaleUndispatchedAttempts();
      const attemptIds = await this.payments.dueAttemptIds(25);
      for (const attemptId of attemptIds) {
        try {
          await this.payments.reconcileAttempt(attemptId);
        } catch {
          // One malformed/provider-specific attempt must not stop reconciliation for the event.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
