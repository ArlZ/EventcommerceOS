import type {
  PaymentProviderCapabilities,
  ProviderObservationOutcome,
  WebhookVerificationStrength,
} from '@event-commerce/domain';

export interface ProviderPayer {
  kind: 'MSISDN';
  value: string;
}

export interface ProviderInitiationInput {
  attemptId: string;
  amountMinor: number;
  currency: string;
  accountReference: string;
  payer: ProviderPayer;
}

export interface ProviderInitiationResult {
  outcome: ProviderObservationOutcome;
  providerRequestId: string | null;
  providerReceiptReference: string | null;
  reasonCode: string | null;
}

export interface ProviderQueryInput {
  attemptId: string;
  providerRequestId: string;
}

export interface ProviderQueryResult {
  outcome: ProviderObservationOutcome;
  providerRequestId: string;
  providerReceiptReference: string | null;
  reasonCode: string | null;
}

export interface ProviderWebhookInput {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: unknown;
  receivedAt: string;
}

export interface ProviderWebhookObservation {
  observationKey: string;
  providerRequestId: string | null;
  outcome: ProviderObservationOutcome;
  providerReceiptReference: string | null;
  reasonCode: string | null;
  verificationStrength: WebhookVerificationStrength;
  payloadHash: string;
  sanitizedDetails: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PaymentProvider {
  readonly code: string;
  capabilities(): PaymentProviderCapabilities;
  initiate(input: ProviderInitiationInput): Promise<ProviderInitiationResult>;
  queryStatus(input: ProviderQueryInput): Promise<ProviderQueryResult>;
  parseAndVerifyWebhook(input: ProviderWebhookInput): Promise<ProviderWebhookObservation>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
