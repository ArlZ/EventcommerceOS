import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  ProviderAvailability,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  VerifiedProviderCallback,
} from './payment-provider';

@Injectable()
export class ExternalTerminalProvider implements PaymentProvider {
  readonly id = 'external_terminal';

  capabilities() {
    return {
      queryStatus: false,
      refunds: false,
      reversals: false,
      asynchronousCallbacks: false,
    } as const;
  }

  availability(): ProviderAvailability {
    return { status: 'AVAILABLE', detailCode: 'CONTROLLED_MANUAL_FALLBACK' };
  }

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
      return { status: 'FAILED', failureCode: 'INVALID_AMOUNT' };
    }
    return {
      status: 'PENDING',
      failureCode: 'AWAITING_EXTERNAL_TERMINAL_CONFIRMATION',
      providerRequestId: request.paymentAttemptId,
    };
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    return {
      status: 'UNKNOWN',
      providerReference,
      failureCode: 'EXTERNAL_TERMINAL_REQUIRES_MANUAL_CONFIRMATION',
    };
  }

  async parseAndVerifyWebhook(): Promise<VerifiedProviderCallback> {
    throw new Error('External terminal fallback does not accept provider webhooks');
  }
}
