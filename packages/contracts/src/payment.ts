export type PaymentAttemptStatus =
  | 'CREATED'
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export type PaymentAdjustmentStatus =
  | 'REQUESTED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

export interface PaymentAttemptEventPayload {
  eventId: string;
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
  eventId: string;
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
  eventId: string;
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

export interface RefundPaymentRequest {
  refundId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  requestingActorId: string;
  approvingActorId?: string;
  idempotencyKey: string;
}

export interface ReversePaymentRequest {
  reversalId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  requestingActorId: string;
  idempotencyKey: string;
}

export interface PaymentAdjustmentView {
  kind: 'REFUND' | 'REVERSAL';
  id: string;
  paymentId: string;
  providerId: string;
  amountMinor: number;
  currency: string;
  reason: string;
  requestingActorId: string;
  approvingActorId: string | null;
  idempotencyKey: string;
  status: PaymentAdjustmentStatus;
  providerReference: string | null;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentFinancialHistoryView {
  paymentId: string;
  refunds: PaymentAdjustmentView[];
  reversals: PaymentAdjustmentView[];
}

export interface PaymentProviderHealthView {
  providerId: string;
  pendingCount: number;
  unknownCount: number;
  unknownValueMinor: number;
  oldestUnknownAt: string | null;
}
