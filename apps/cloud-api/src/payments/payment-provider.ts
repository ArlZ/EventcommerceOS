import type { PaymentProviderCapabilities, PaymentAttemptState } from '@event-commerce/domain';

export interface ProviderInitiationRequest {
  paymentAttemptId: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  customerPhone?: string;
  accountReference: string;
  description?: string;
}

export interface ProviderInitiationResult {
  status: Extract<PaymentAttemptState, 'INITIATED' | 'PENDING' | 'FAILED' | 'UNKNOWN'>;
  providerReference?: string;
  failureCode?: string;
  providerRequestId?: string;
}

export interface ProviderStatusResult {
  status: Extract<PaymentAttemptState, 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'>;
  providerReference?: string;
  failureCode?: string;
}

export type ProviderTruthState = Extract<
  PaymentAttemptState,
  'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
>;

export interface VerifiedProviderCallback {
  providerEventKey: string;
  paymentAttemptId?: string | undefined;
  providerReference?: string | null | undefined;
  status: ProviderTruthState;
  amountMinor?: number | undefined;
  currency?: string | undefined;
  failureCode?: string | undefined;
}

export interface PaymentProvider {
  readonly id: string;
  capabilities(): PaymentProviderCapabilities;
  initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult>;
  queryStatus(providerReference: string): Promise<ProviderStatusResult>;
  parseAndVerifyWebhook(payload: unknown): Promise<VerifiedProviderCallback>;
  refund?(input: {
    providerReference: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<ProviderStatusResult>;
  reverse?(input: {
    providerReference: string;
    amountMinor: number;
    currency: string;
    idempotencyKey: string;
  }): Promise<ProviderStatusResult>;
}

export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');
