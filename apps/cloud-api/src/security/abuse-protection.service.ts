import { Injectable } from '@nestjs/common';

export type AbusePolicyName =
  | 'EDGE_SYNC'
  | 'EDGE_PAYMENT'
  | 'PROVIDER_CALLBACK'
  | 'OPERATOR_READ'
  | 'OPERATOR_MUTATION'
  | 'PUBLIC';

export interface AbusePolicy {
  name: AbusePolicyName;
  requestsPerMinute: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

const DEFAULT_LIMITS: Record<AbusePolicyName, number> = {
  EDGE_SYNC: 1_200,
  EDGE_PAYMENT: 3_000,
  PROVIDER_CALLBACK: 1_200,
  OPERATOR_READ: 1_200,
  OPERATOR_MUTATION: 240,
  PUBLIC: 120,
};

const ENV_BY_POLICY: Record<AbusePolicyName, string> = {
  EDGE_SYNC: 'ABUSE_LIMIT_EDGE_SYNC_PER_MINUTE',
  EDGE_PAYMENT: 'ABUSE_LIMIT_EDGE_PAYMENT_PER_MINUTE',
  PROVIDER_CALLBACK: 'ABUSE_LIMIT_PROVIDER_CALLBACK_PER_MINUTE',
  OPERATOR_READ: 'ABUSE_LIMIT_OPERATOR_READ_PER_MINUTE',
  OPERATOR_MUTATION: 'ABUSE_LIMIT_OPERATOR_MUTATION_PER_MINUTE',
  PUBLIC: 'ABUSE_LIMIT_PUBLIC_PER_MINUTE',
};

function boundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

@Injectable()
export class AbuseProtectionService {
  private readonly buckets = new Map<string, Bucket>();
  private readonly policies: Record<AbusePolicyName, AbusePolicy>;
  private readonly maxBuckets: number;

  constructor() {
    this.policies = Object.fromEntries(
      (Object.keys(DEFAULT_LIMITS) as AbusePolicyName[]).map((name) => [
        name,
        {
          name,
          requestsPerMinute: boundedInteger(
            ENV_BY_POLICY[name],
            DEFAULT_LIMITS[name],
            10,
            100_000,
          ),
        },
      ]),
    ) as Record<AbusePolicyName, AbusePolicy>;
    this.maxBuckets = boundedInteger('ABUSE_MAX_BUCKETS', 20_000, 1_000, 100_000);
  }

  policy(name: AbusePolicyName): AbusePolicy {
    return this.policies[name];
  }

  consume(policyName: AbusePolicyName, key: string, now = Date.now()): RateLimitDecision {
    const policy = this.policies[policyName];
    const bucketKey = `${policyName}:${key}`;
    const refillPerMs = policy.requestsPerMinute / 60_000;
    const existing = this.buckets.get(bucketKey);
    const elapsed = existing ? Math.max(0, now - existing.updatedAt) : 0;
    const available = existing
      ? Math.min(policy.requestsPerMinute, existing.tokens + elapsed * refillPerMs)
      : policy.requestsPerMinute;

    if (available < 1) {
      this.touch(bucketKey, { tokens: available, updatedAt: now });
      const missing = 1 - available;
      return {
        allowed: false,
        limit: policy.requestsPerMinute,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(missing / refillPerMs / 1000)),
      };
    }

    const remaining = available - 1;
    this.touch(bucketKey, { tokens: remaining, updatedAt: now });
    return {
      allowed: true,
      limit: policy.requestsPerMinute,
      remaining: Math.max(0, Math.floor(remaining)),
      retryAfterSeconds: 0,
    };
  }

  bucketCount(): number {
    return this.buckets.size;
  }

  private touch(key: string, bucket: Bucket): void {
    if (this.buckets.has(key)) this.buckets.delete(key);
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.buckets.delete(oldest);
    }
    this.buckets.set(key, bucket);
  }
}
