import { createHash } from 'node:crypto';
import type { PaymentProviderCapabilities, ProviderObservationOutcome } from '@event-commerce/domain';
import type {
  PaymentProvider,
  ProviderInitiationInput,
  ProviderInitiationResult,
  ProviderQueryInput,
  ProviderQueryResult,
  ProviderWebhookInput,
  ProviderWebhookObservation,
} from './payment-provider';

interface DarajaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passKey: string;
  callbackUrl: string;
  transactionType: string;
  timeoutMs: number;
}

interface TokenCache {
  value: string;
  expiresAtEpochMs: number;
}

type HttpClient = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = record(value);
  if (!object) return JSON.stringify(String(value));
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function payloadHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function formatTimestamp(now: Date): string {
  const year = now.getUTCFullYear().toString().padStart(4, '0');
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  const hour = now.getUTCHours().toString().padStart(2, '0');
  const minute = now.getUTCMinutes().toString().padStart(2, '0');
  const second = now.getUTCSeconds().toString().padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}${second}`;
}

function resultDescription(value: unknown): string | null {
  const valueText = text(value);
  return valueText ? valueText.slice(0, 200) : null;
}

function explicitlyTerminalOutcome(code: string, description: string | null): ProviderObservationOutcome {
  if (code === '0') return 'SUCCESS';
  const normalized = (description ?? '').toLowerCase();
  if (normalized.includes('expired') || normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'EXPIRED';
  }
  if (
    normalized.includes('cancel') ||
    normalized.includes('insufficient') ||
    normalized.includes('wrong pin') ||
    normalized.includes('declin') ||
    normalized.includes('failed')
  ) {
    return 'FAILED';
  }
  // Unknown non-zero codes stay unresolved. A false failure could invite a duplicate charge.
  return 'UNKNOWN';
}

function callbackMetadata(callback: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const metadata = record(callback.CallbackMetadata);
  const items = metadata && Array.isArray(metadata.Item) ? metadata.Item : [];
  const safe: Record<string, string | number | boolean | null> = {};
  for (const rawItem of items) {
    const item = record(rawItem);
    if (!item) continue;
    const name = text(item.Name);
    if (!name || !['Amount', 'MpesaReceiptNumber', 'TransactionDate'].includes(name)) continue;
    const value = item.Value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      safe[name] = value;
    }
  }
  return safe;
}

export class MpesaDarajaProvider implements PaymentProvider {
  readonly code = 'MPESA';
  private tokenCache: TokenCache | null = null;

  constructor(
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly http: HttpClient = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  capabilities(): PaymentProviderCapabilities {
    return {
      queryStatus: true,
      refund: false,
      reverse: false,
      webhookVerification: 'CORRELATION_ONLY',
    };
  }

  async initiate(input: ProviderInitiationInput): Promise<ProviderInitiationResult> {
    if (input.currency !== 'KES' || input.amountMinor <= 0 || input.amountMinor % 100 !== 0) {
      return this.failedInitiation('UNSUPPORTED_MPESA_AMOUNT');
    }

    let config: DarajaConfig;
    try {
      config = this.config();
    } catch {
      return this.failedInitiation('PROVIDER_CONFIGURATION_MISSING');
    }

    let accessToken: string;
    try {
      accessToken = await this.accessToken(config);
    } catch {
      // OAuth happens before an STK request is sent, so this is a safe failure rather than UNKNOWN.
      return this.failedInitiation('PROVIDER_AUTH_UNAVAILABLE');
    }

    const timestamp = formatTimestamp(this.now());
    const password = Buffer.from(`${config.shortCode}${config.passKey}${timestamp}`).toString('base64');
    const amount = input.amountMinor / 100;
    let response: Response;
    try {
      response = await this.http(`${config.baseUrl}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: config.shortCode,
          Password: password,
          Timestamp: timestamp,
          TransactionType: config.transactionType,
          Amount: amount,
          PartyA: input.payer.value,
          PartyB: config.shortCode,
          PhoneNumber: input.payer.value,
          CallBackURL: config.callbackUrl,
          AccountReference: input.accountReference.slice(0, 12),
          TransactionDesc: 'Event payment',
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      // The request may have reached Safaricom. The orchestrator must move this attempt to UNKNOWN.
      throw new Error('ambiguous M-PESA initiation transport failure');
    }

    const body = await this.responseBody(response);
    const responseCode = text(body.ResponseCode);
    const requestId = text(body.CheckoutRequestID);
    if (response.ok && responseCode === '0' && requestId) {
      return {
        outcome: 'ACCEPTED_FOR_PROCESSING',
        providerRequestId: requestId,
        providerReceiptReference: null,
        reasonCode: responseCode,
      };
    }
    if (response.status >= 500) {
      throw new Error('ambiguous M-PESA gateway failure');
    }
    return {
      outcome: 'FAILED',
      providerRequestId: requestId,
      providerReceiptReference: null,
      reasonCode: text(body.errorCode) ?? responseCode ?? `HTTP_${response.status}`,
    };
  }

  async queryStatus(input: ProviderQueryInput): Promise<ProviderQueryResult> {
    let config: DarajaConfig;
    try {
      config = this.config();
    } catch {
      return this.unknownQuery(input, 'PROVIDER_CONFIGURATION_MISSING');
    }

    let accessToken: string;
    try {
      accessToken = await this.accessToken(config);
    } catch {
      return this.unknownQuery(input, 'PROVIDER_AUTH_UNAVAILABLE');
    }

    const timestamp = formatTimestamp(this.now());
    const password = Buffer.from(`${config.shortCode}${config.passKey}${timestamp}`).toString('base64');
    let response: Response;
    try {
      response = await this.http(`${config.baseUrl}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          BusinessShortCode: config.shortCode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: input.providerRequestId,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch {
      throw new Error('M-PESA status query transport failure');
    }

    if (response.status >= 500) throw new Error('M-PESA status query gateway failure');
    const body = await this.responseBody(response);
    if (!response.ok || text(body.ResponseCode) !== '0') {
      return this.unknownQuery(
        input,
        text(body.errorCode) ?? text(body.ResponseCode) ?? `HTTP_${response.status}`,
      );
    }

    const resultCode = text(body.ResultCode);
    if (!resultCode) return this.unknownQuery(input, 'QUERY_RESULT_MISSING');
    const description = resultDescription(body.ResultDesc);
    return {
      outcome: explicitlyTerminalOutcome(resultCode, description),
      providerRequestId: text(body.CheckoutRequestID) ?? input.providerRequestId,
      providerReceiptReference: null,
      reasonCode: resultCode,
    };
  }

  async parseAndVerifyWebhook(input: ProviderWebhookInput): Promise<ProviderWebhookObservation> {
    const root = record(input.body);
    const body = root ? record(root.Body) : null;
    const callback = body ? record(body.stkCallback) : null;
    if (!callback) throw new Error('invalid M-PESA STK callback payload');

    const requestId = text(callback.CheckoutRequestID);
    const resultCode = text(callback.ResultCode);
    if (!resultCode) throw new Error('M-PESA callback is missing ResultCode');
    const description = resultDescription(callback.ResultDesc);
    const metadata = callbackMetadata(callback);
    const receipt = typeof metadata.MpesaReceiptNumber === 'string' ? metadata.MpesaReceiptNumber : null;
    const hash = payloadHash(input.body);

    return {
      observationKey: requestId ? `stk:${requestId}` : `stk-unidentified:${hash}`,
      providerRequestId: requestId,
      outcome: explicitlyTerminalOutcome(resultCode, description),
      providerReceiptReference: receipt,
      reasonCode: resultCode,
      verificationStrength: 'CORRELATION_ONLY',
      payloadHash: hash,
      sanitizedDetails: {
        resultCode,
        resultDescription: description,
        amount: typeof metadata.Amount === 'number' ? metadata.Amount : null,
        transactionDate:
          typeof metadata.TransactionDate === 'string' || typeof metadata.TransactionDate === 'number'
            ? String(metadata.TransactionDate)
            : null,
        hasReceiptReference: receipt !== null,
      },
    };
  }

  private config(): DarajaConfig {
    const environment = this.environment.MPESA_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
    const required = (name: string): string => {
      const value = this.environment[name]?.trim();
      if (!value) throw new Error(`missing ${name}`);
      return value;
    };
    const timeout = Number(this.environment.MPESA_HTTP_TIMEOUT_MS ?? '10000');
    return {
      baseUrl:
        this.environment.MPESA_BASE_URL?.trim() ||
        (environment === 'production'
          ? 'https://api.safaricom.co.ke'
          : 'https://sandbox.safaricom.co.ke'),
      consumerKey: required('MPESA_CONSUMER_KEY'),
      consumerSecret: required('MPESA_CONSUMER_SECRET'),
      shortCode: required('MPESA_SHORTCODE'),
      passKey: required('MPESA_PASSKEY'),
      callbackUrl: required('MPESA_CALLBACK_URL'),
      transactionType: this.environment.MPESA_TRANSACTION_TYPE?.trim() || 'CustomerPayBillOnline',
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 30_000) : 10_000,
    };
  }

  private async accessToken(config: DarajaConfig): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAtEpochMs - 30_000 > now) return this.tokenCache.value;
    const authorization = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const response = await this.http(`${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
      method: 'GET',
      headers: { authorization: `Basic ${authorization}` },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) throw new Error('M-PESA OAuth rejected');
    const body = await this.responseBody(response);
    const token = text(body.access_token);
    if (!token) throw new Error('M-PESA OAuth response missing token');
    const expiresInSeconds = Number(text(body.expires_in) ?? '3599');
    this.tokenCache = {
      value: token,
      expiresAtEpochMs:
        now + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3599) * 1000,
    };
    return token;
  }

  private async responseBody(response: Response): Promise<Record<string, unknown>> {
    try {
      return record(await response.json()) ?? {};
    } catch {
      return {};
    }
  }

  private failedInitiation(reasonCode: string): ProviderInitiationResult {
    return {
      outcome: 'FAILED',
      providerRequestId: null,
      providerReceiptReference: null,
      reasonCode,
    };
  }

  private unknownQuery(input: ProviderQueryInput, reasonCode: string): ProviderQueryResult {
    return {
      outcome: 'UNKNOWN',
      providerRequestId: input.providerRequestId,
      providerReceiptReference: null,
      reasonCode,
    };
  }
}
