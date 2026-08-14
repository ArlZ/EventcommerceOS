import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentRelayService } from './payment-relay.service';

@Injectable()
export class PaymentRefreshService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

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

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const attemptIds = await this.payments.dueAttemptIds(25);
      for (const attemptId of attemptIds) {
        try {
          await this.payments.refreshAttempt(attemptId);
        } catch {
          // A single corrupt/unreachable attempt must not stop the event payment refresh batch.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
