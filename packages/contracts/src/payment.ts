export type PaymentAttemptState =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED'
  | 'UNKNOWN'
  | 'REVERSED';

export type PaymentProviderCode = 'MPESA';

export interface PaymentPayerInput {
  kind: 'MSISDN';
  value: string;
}

export interface InitiatePaymentRequest {
  eventId: string;
  orderId: string;
  paymentId: string;
  clientAttemptId: string;
  idempotencyKey: string;
  provider: PaymentProviderCode;
  amountMinor: number;
  currency: string;
  payer: PaymentPayerInput;
}

export interface PaymentAttemptSnapshot {
  paymentId: string;
  attemptId: string;
  clientAttemptId: string;
  eventId: string;
  orderId: string;
  provider: PaymentProviderCode;
  state: PaymentAttemptState;
  amountMinor: number;
  currency: string;
  maskedPayerReference: string | null;
  providerRequestId: string | null;
  providerReceiptReference: string | null;
  createdAt: string;
  updatedAt: string;
  reconciliationRequired: boolean;
}

export interface InitiatePaymentResponse {
  attempt: PaymentAttemptSnapshot;
  idempotentReplay: boolean;
}

export interface QueryPaymentResponse {
  attempt: PaymentAttemptSnapshot;
}

export interface PaymentProviderCapabilitiesContract {
  queryStatus: boolean;
  refund: boolean;
  reverse: boolean;
  webhookVerification: 'CRYPTOGRAPHIC' | 'CORRELATION_ONLY' | 'NONE';
}
