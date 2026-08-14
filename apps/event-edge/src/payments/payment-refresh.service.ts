import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentRelayService } from './payment-relay.service';

@Injectable()
export class PaymentRefreshService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private activeTick: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(@Inject(PaymentRelayService) private readonly payments: PaymentRelayService) {}

  onModuleInit(): void {
    if (process.env.EDGE_PAYMENT_REFRESH_DISABLED === 'true') return;
    const configured = Number(process.env.EDGE_PAYMENT_REFRESH_INTERVAL_MS ?? '5000');
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
    const work = this.runTick().catch(() => {
      // This is a repair/status loop, not a checkout path. Shutdown or one unexpected
      // database/transport failure must not escape as an unhandled process rejection.
    });
    this.activeTick = work;
    try {
      await work;
    } finally {
      if (this.activeTick === work) this.activeTick = null;
    }
  }

  private async runTick(): Promise<void> {
    const attemptIds = await this.payments.dueAttemptIds(25);
    for (const attemptId of attemptIds) {
      if (this.shuttingDown) return;
      try {
        await this.payments.refreshAttempt(attemptId);
      } catch {
        // A single corrupt/unreachable attempt must not stop the event payment refresh batch.
      }
    }
  }
}
