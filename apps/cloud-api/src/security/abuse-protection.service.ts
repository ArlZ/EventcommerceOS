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
  burst: number;
  maxInFlight: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  burst: number;
  remaining: number;
  retryAfterSeconds: number;
}

const DEFAULTS: Record<AbusePolicyName, Omit<AbusePolicy, 'name'>> = {
  EDGE_SYNC: { requestsPerMinute: 1_200, burst: 120, maxInFlight: 64 },
  EDGE_PAYMENT: { requestsPerMinute: 3_000, burst: 300, maxInFlight: 128 },
  PROVIDER_CALLBACK: { requestsPerMinute: 1_200, burst: 200, maxInFlight: 128 },
  OPERATOR_READ: { requestsPerMinute: 600, burst: 60, maxInFlight: 128 },
  OPERATOR_MUTATION: { requestsPerMinute: 120, burst: 30, maxInFlight: 32 },
  PUBLIC: { requestsPerMinute: 120, burst: 30, maxInFlight: 64 },
};

function envName(policy: AbusePolicyName, suffix: string): string {
  return `ABUSE_${policy}_${suffix}`;
}

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
  private readonly inFlight = new Map<AbusePolicyName, number>();
  private readonly policies: Record<AbusePolicyName, AbusePolicy>;
  private readonly maxBuckets: number;

  constructor() {
    this.policies = Object.fromEntries(
      (Object.keys(DEFAULTS) as AbusePolicyName[]).map((name) => {
        const defaults = DEFAULTS[name];
        const requestsPerMinute = boundedInteger(
          envName(name, 'PER_MINUTE'),
          defaults.requestsPerMinute,
          10,
          100_000,
        );
        const burst = boundedInteger(envName(name, 'BURST'), defaults.burst, 5, 10_000);
        if (burst > requestsPerMinute) {
          throw new Error(`ABUSE_${name}_BURST must not exceed ABUSE_${name}_PER_MINUTE`);
        }
        return [
          name,
          {
            name,
            requestsPerMinute,
            burst,
            maxInFlight: boundedInteger(
              envName(name, 'MAX_IN_FLIGHT'),
              defaults.maxInFlight,
              1,
              5_000,
            ),
          },
        ];
      }),
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
      ? Math.min(policy.burst, existing.tokens + elapsed * refillPerMs)
      : policy.burst;

    if (available < 1) {
      this.touch(bucketKey, { tokens: available, updatedAt: now });
      const missing = 1 - available;
      return {
        allowed: false,
        limit: policy.requestsPerMinute,
        burst: policy.burst,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(missing / refillPerMs / 1000)),
      };
    }

    const remaining = available - 1;
    this.touch(bucketKey, { tokens: remaining, updatedAt: now });
    return {
      allowed: true,
      limit: policy.requestsPerMinute,
      burst: policy.burst,
      remaining: Math.max(0, Math.floor(remaining)),
      retryAfterSeconds: 0,
    };
  }

  tryEnter(policyName: AbusePolicyName): boolean {
    const current = this.inFlight.get(policyName) ?? 0;
    if (current >= this.policies[policyName].maxInFlight) return false;
    this.inFlight.set(policyName, current + 1);
    return true;
  }

  leave(policyName: AbusePolicyName): void {
    const current = this.inFlight.get(policyName) ?? 0;
    if (current <= 1) this.inFlight.delete(policyName);
    else this.inFlight.set(policyName, current - 1);
  }

  inFlightCount(policyName: AbusePolicyName): number {
    return this.inFlight.get(policyName) ?? 0;
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
