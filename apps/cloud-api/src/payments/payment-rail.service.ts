import { Inject, Injectable } from '@nestjs/common';
import type { PaymentRailAvailabilityView } from '@event-commerce/contracts';
import { PAYMENT_PROVIDERS, type PaymentProvider } from './payment-provider';

@Injectable()
export class PaymentRailService {
  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: readonly PaymentProvider[],
  ) {}

  availability(): PaymentRailAvailabilityView[] {
    return this.providers
      .map((provider) => {
        const availability = provider.availability?.() ?? {
          status: 'DEGRADED' as const,
          detailCode: 'PROVIDER_AVAILABILITY_NOT_EXPOSED',
        };
        return {
          providerId: provider.id,
          status: availability.status,
          detailCode: availability.detailCode ?? null,
        };
      })
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }
}
