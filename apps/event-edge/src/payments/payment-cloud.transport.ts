import type {
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  PaymentAttemptSnapshot,
} from '@event-commerce/contracts';

export abstract class PaymentCloudTransport {
  abstract initiate(input: InitiatePaymentRequest): Promise<InitiatePaymentResponse>;
  abstract getAttempt(attemptId: string): Promise<PaymentAttemptSnapshot | null>;
}
