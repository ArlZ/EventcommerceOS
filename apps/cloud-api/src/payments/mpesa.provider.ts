import { Injectable } from '@nestjs/common';
import type {
  PaymentProvider,
  ProviderInitiationRequest,
  ProviderInitiationResult,
  ProviderStatusResult,
  VerifiedProviderCallback,
} from './payment-provider';

interface MpesaConfig {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
  businessShortCode: string;
  passkey: string;
  callbackUrl: string;
  transactionType: string;
  timeoutMs: number;
}

interface MpesaTokenResponse {
  access_token?: string;
}

interface MpesaStkResponse {
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  ResponseCode?: string;
  ResponseDescription?: string;
  errorCode?: string;
  errorMessage?: string;
}

interface MpesaQueryResponse {
  CheckoutRequestID?: string;
  ResultCode?: string;
  ResultDesc?: string;
  ResponseCode?: string;
  errorCode?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required M-PESA configuration: ${name}`);
  return value;
}

function timestamp(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid M-PESA payload');
  }
  return value as Record<string, unknown>;
}

function callbackMetadataValue(items: unknown, name: string): string | number | undefined {
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (
      record.Name === name &&
      (typeof record.Value === 'string' || typeof record.Value === 'number')
    ) {
      return record.Value;
    }
  }
  return undefined;
}

@Injectable()
export class MpesaProvider implements PaymentProvider {
  readonly id = 'mpesa';

  capabilities() {
    return {
      queryStatus: true,
      refunds: false,
      reversals: false,
      asynchronousCallbacks: true,
    } as const;
  }

  async initiate(request: ProviderInitiationRequest): Promise<ProviderInitiationResult> {
    if (request.currency !== 'KES') {
      return { status: 'FAILED', failureCode: 'UNSUPPORTED_CURRENCY' };
    }
    if (!Number.isSafeInteger(request.amountMinor) || request.amountMinor <= 0) {
      return { status: 'FAILED', failureCode: 'INVALID_AMOUNT' };
    }
    if (request.amountMinor % 100 !== 0) {
      return { status: 'FAILED', failureCode: 'MPESA_WHOLE_KES_REQUIRED' };
    }
    if (!request.customerPhone) {
      return { status: 'FAILED', failureCode: 'CUSTOMER_PHONE_REQUIRED' };
    }

    const config = this.config();
    const requestTimestamp = timestamp(new Date());
    const password = btoa(`${config.businessShortCode}${config.passkey}${requestTimestamp}`);

    try {
      const token = await this.accessToken(config);
      const response = await this.post<MpesaStkResponse>(
        `${config.baseUrl}/mpesa/stkpush/v1/processrequest`,
        token,
        {
          BusinessShortCode: config.businessShortCode,
          Password: password,
          Timestamp: requestTimestamp,
          TransactionType: config.transactionType,
          Amount: request.amountMinor / 100,
          PartyA: request.customerPhone,
          PartyB: config.businessShortCode,
          PhoneNumber: request.customerPhone,
          CallBackURL: config.callbackUrl,
          AccountReference: request.accountReference,
          TransactionDesc: request.description ?? request.accountReference,
        },
        config.timeoutMs,
      );

      if (response.ResponseCode === '0' && response.CheckoutRequestID) {
        return {
          status: 'PENDING',
          providerReference: response.CheckoutRequestID,
          ...(response.MerchantRequestID ? { providerRequestId: response.MerchantRequestID } : {}),
        };
      }

      return {
        status: 'FAILED',
        failureCode: response.errorCode ?? response.ResponseCode ?? 'MPESA_INITIATION_REJECTED',
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { status: 'UNKNOWN', failureCode: 'PROVIDER_TIMEOUT' };
      }
      return { status: 'UNKNOWN', failureCode: 'PROVIDER_TRANSPORT_ERROR' };
    }
  }

  async queryStatus(providerReference: string): Promise<ProviderStatusResult> {
    const config = this.config();
    const requestTimestamp = timestamp(new Date());
    const password = btoa(`${config.businessShortCode}${config.passkey}${requestTimestamp}`);

    try {
      const token = await this.accessToken(config);
      const response = await this.post<MpesaQueryResponse>(
        `${config.baseUrl}/mpesa/stkpushquery/v1/query`,
        token,
        {
          BusinessShortCode: config.businessShortCode,
          Password: password,
          Timestamp: requestTimestamp,
          CheckoutRequestID: providerReference,
        },
        config.timeoutMs,
      );

      if (response.ResultCode === '0') {
        return { status: 'SUCCEEDED', providerReference };
      }
      if (response.ResultCode) {
        return { status: 'FAILED', providerReference, failureCode: response.ResultCode };
      }
      if (response.ResponseCode === '0') {
        return { status: 'PENDING', providerReference };
      }
      return {
        status: 'UNKNOWN',
        providerReference,
        failureCode: response.errorCode ?? 'MPESA_STATUS_UNKNOWN',
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        return { status: 'UNKNOWN', providerReference, failureCode: 'PROVIDER_TIMEOUT' };
      }
      return { status: 'UNKNOWN', providerReference, failureCode: 'PROVIDER_TRANSPORT_ERROR' };
    }
  }

  async parseAndVerifyWebhook(payload: unknown): Promise<VerifiedProviderCallback> {
    const root = parseObject(payload);
    const body = parseObject(root.Body);
    const callback = parseObject(body.stkCallback);

    const checkoutRequestId = callback.CheckoutRequestID;
    const merchantRequestId = callback.MerchantRequestID;
    const resultCode = callback.ResultCode;

    if (typeof checkoutRequestId !== 'string' || !checkoutRequestId.trim()) {
      throw new Error('M-PESA callback missing CheckoutRequestID');
    }
    if (typeof resultCode !== 'number') {
      throw new Error('M-PESA callback missing numeric ResultCode');
    }

    const metadata = callback.CallbackMetadata;
    const metadataItems =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).Item
        : undefined;
    const amount = callbackMetadataValue(metadataItems, 'Amount');
    const receipt = callbackMetadataValue(metadataItems, 'MpesaReceiptNumber');

    const providerEventKey = `${String(merchantRequestId ?? '')}:${checkoutRequestId}:${resultCode}:${String(
      receipt ?? '',
    )}`;

    if (
      resultCode === 0 &&
      (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0)
    ) {
      throw new Error('Successful M-PESA callback missing valid Amount');
    }

    return {
      providerEventKey,
      providerReference: checkoutRequestId,
      status: 'UNKNOWN',
      ...(typeof amount === 'number' && Number.isFinite(amount)
        ? { amountMinor: Math.round(amount * 100), currency: 'KES' }
        : {}),
      failureCode: `MPESA_CALLBACK_RESULT_${resultCode}`,
    };
  }

  private config(): MpesaConfig {
    const timeoutMs = Number(process.env.MPESA_TIMEOUT_MS ?? '10000');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('MPESA_TIMEOUT_MS must be a positive integer');
    }
    return {
      baseUrl: (process.env.MPESA_BASE_URL ?? 'https://sandbox.safaricom.co.ke').replace(/\/$/, ''),
      consumerKey: required('MPESA_CONSUMER_KEY'),
      consumerSecret: required('MPESA_CONSUMER_SECRET'),
      businessShortCode: required('MPESA_BUSINESS_SHORT_CODE'),
      passkey: required('MPESA_PASSKEY'),
      callbackUrl: required('MPESA_CALLBACK_URL'),
      transactionType: process.env.MPESA_TRANSACTION_TYPE ?? 'CustomerPayBillOnline',
      timeoutMs,
    };
  }

  private async accessToken(config: MpesaConfig): Promise<string> {
    const credentials = btoa(`${config.consumerKey}:${config.consumerSecret}`);
    const response = await fetch(
      `${config.baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${credentials}` },
        signal: AbortSignal.timeout(config.timeoutMs),
      },
    );
    if (!response.ok) throw new Error(`M-PESA OAuth failed: ${response.status}`);
    const body = (await response.json()) as MpesaTokenResponse;
    if (!body.access_token) throw new Error('M-PESA OAuth response missing access_token');
    return body.access_token;
  }

  private async post<T>(
    url: string,
    token: string,
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = (await response.json()) as T;
    if (!response.ok) throw new Error(`M-PESA request failed: ${response.status}`);
    return parsed;
  }
}
