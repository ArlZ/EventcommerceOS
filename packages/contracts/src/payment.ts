export type PaymentAttemptStatus =
  | 'CREATED'
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export interface PaymentAttemptEventPayload {
  paymentId: string;
  paymentAttemptId: string;
  orderId: string;
  providerId: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  providerReference?: string;
  failureCode?: string;
  customerReferenceMasked?: string;
}

export interface InitiatePaymentRequest {
  paymentId: string;
  paymentAttemptId: string;
  orderId: string;
  providerId: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  customerPhone?: string;
  accountReference: string;
  description?: string;
}

export interface PaymentAttemptView {
  paymentId: string;
  paymentAttemptId: string;
  orderId: string;
  providerId: string;
  amountMinor: number;
  currency: string;
  status: PaymentAttemptStatus;
  providerReference: string | null;
  failureCode: string | null;
  reconciliationRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentProviderHealthView {
  providerId: string;
  pendingCount: number;
  unknownCount: number;
  unknownValueMinor: number;
  oldestUnknownAt: string | null;
}
