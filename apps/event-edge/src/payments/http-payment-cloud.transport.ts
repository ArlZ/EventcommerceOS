import { Injectable } from '@nestjs/common';
import type { InitiatePaymentRequest, InitiatePaymentResponse, PaymentAttemptSnapshot } from '@event-commerce/contracts';
import { PaymentCloudTransport } from './payment-cloud.transport';
import { parseCloudPaymentSnapshot } from './payment.validation';

function cloudBaseUrl(): URL {
  const base = new URL(process.env.CLOUD_API_URL ?? 'http://127.0.0.1:3000');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !loopback) {
    throw new Error('payment Edge-to-Cloud transport requires HTTPS outside loopback development');
  }
  return base;
}

function timeoutMs(): number {
  const configured = Number(process.env.PAYMENT_CLOUD_TIMEOUT_MS ?? '5000');
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 30_000) : 5000;
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { 'content-type': 'application/json' };
  const token = process.env.CLOUD_API_BEARER_TOKEN?.trim();
  if (token) result.authorization = `Bearer ${token}`;
  return result;
}

@Injectable()
export class HttpPaymentCloudTransport extends PaymentCloudTransport {
  async initiate(input: InitiatePaymentRequest): Promise<InitiatePaymentResponse> {
    const response = await fetch(new URL('/payments/attempts', cloudBaseUrl()), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!response.ok) {
      throw new Error(`payment Cloud initiation failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('payment Cloud initiation response is invalid');
    }
    const row = body as Record<string, unknown>;
    if (typeof row.idempotentReplay !== 'boolean') {
      throw new Error('payment Cloud initiation replay marker is invalid');
    }
    return {
      attempt: parseCloudPaymentSnapshot(row.attempt),
      idempotentReplay: row.idempotentReplay,
    };
  }

  async getAttempt(attemptId: string): Promise<PaymentAttemptSnapshot | null> {
    const response = await fetch(
      new URL(`/payments/attempts/${encodeURIComponent(attemptId)}`, cloudBaseUrl()),
      {
        method: 'GET',
        headers: headers(),
        signal: AbortSignal.timeout(timeoutMs()),
      },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`payment Cloud status failed with HTTP ${response.status}`);
    return parseCloudPaymentSnapshot((await response.json()) as unknown);
  }
}
