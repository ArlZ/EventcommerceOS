import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentService } from './payment.service';

@Injectable()
export class PaymentReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private activeTick: Promise<void> | null = null;
  private shuttingDown = false;

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

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeTick;
  }

  async tick(): Promise<void> {
    if (this.shuttingDown || this.activeTick) return;

    const work = this.runTick();
    this.activeTick = work;
    try {
      await work;
    } finally {
      if (this.activeTick === work) this.activeTick = null;
    }
  }

  private async runTick(): Promise<void> {
    await this.payments.failStaleUndispatchedAttempts();
    if (this.shuttingDown) return;

    const attemptIds = await this.payments.dueAttemptIds(25);
    for (const attemptId of attemptIds) {
      if (this.shuttingDown) return;
      try {
        await this.payments.reconcileAttempt(attemptId);
      } catch {
        // One malformed/provider-specific attempt must not stop reconciliation for the event.
      }
    }
  }
}
