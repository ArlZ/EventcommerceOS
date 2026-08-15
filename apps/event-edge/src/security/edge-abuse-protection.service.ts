import { Injectable } from '@nestjs/common';

export type EdgeAbusePolicyName = 'DEVICE_SYNC' | 'DEVICE_PAYMENT' | 'LOCAL_OTHER';

export interface EdgeAbusePolicy {
  name: EdgeAbusePolicyName;
  requestsPerMinute: number;
  burst: number;
  maxInFlight: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const DEFAULTS: Record<EdgeAbusePolicyName, Omit<EdgeAbusePolicy, 'name'>> = {
  DEVICE_SYNC: { requestsPerMinute: 1_800, burst: 180, maxInFlight: 64 },
  DEVICE_PAYMENT: { requestsPerMinute: 1_200, burst: 120, maxInFlight: 192 },
  LOCAL_OTHER: { requestsPerMinute: 300, burst: 60, maxInFlight: 64 },
};

function bounded(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function rateEnv(policy: EdgeAbusePolicyName): string {
  return `EDGE_ABUSE_LIMIT_${policy}_PER_MINUTE`;
}

function burstEnv(policy: EdgeAbusePolicyName): string {
  return `EDGE_ABUSE_BURST_${policy}`;
}

function inFlightEnv(policy: EdgeAbusePolicyName): string {
  return `EDGE_ABUSE_MAX_IN_FLIGHT_${policy}`;
}

@Injectable()
export class EdgeAbuseProtectionService {
  private readonly policies: Record<EdgeAbusePolicyName, EdgeAbusePolicy>;
  private readonly buckets = new Map<string, Bucket>();
  private readonly inFlight = new Map<EdgeAbusePolicyName, number>();
  private readonly maxBuckets = bounded('EDGE_ABUSE_MAX_BUCKETS', 10_000, 500, 50_000);

  constructor() {
    this.policies = Object.fromEntries(
      (Object.keys(DEFAULTS) as EdgeAbusePolicyName[]).map((name) => {
        const defaults = DEFAULTS[name];
        const requestsPerMinute = bounded(
          rateEnv(name),
          defaults.requestsPerMinute,
          30,
          100_000,
        );
        const burst = bounded(burstEnv(name), defaults.burst, 5, 10_000);
        if (burst > requestsPerMinute) {
          throw new Error(`${burstEnv(name)} must not exceed ${rateEnv(name)}`);
        }
        return [
          name,
          {
            name,
            requestsPerMinute,
            burst,
            maxInFlight: bounded(inFlightEnv(name), defaults.maxInFlight, 1, 5_000),
          },
        ];
      }),
    ) as Record<EdgeAbusePolicyName, EdgeAbusePolicy>;
  }

  policy(name: EdgeAbusePolicyName): EdgeAbusePolicy {
    return this.policies[name];
  }

  consume(
    policyName: EdgeAbusePolicyName,
    key: string,
    now = Date.now(),
  ): { allowed: boolean; remaining: number; retryAfter: number } {
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
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, Math.ceil((1 - available) / refillPerMs / 1000)),
      };
    }

    const remaining = available - 1;
    this.touch(bucketKey, { tokens: remaining, updatedAt: now });
    return { allowed: true, remaining: Math.max(0, Math.floor(remaining)), retryAfter: 0 };
  }

  tryEnter(policy: EdgeAbusePolicyName): boolean {
    const current = this.inFlight.get(policy) ?? 0;
    if (current >= this.policies[policy].maxInFlight) return false;
    this.inFlight.set(policy, current + 1);
    return true;
  }

  leave(policy: EdgeAbusePolicyName): void {
    const current = this.inFlight.get(policy) ?? 0;
    if (current <= 1) this.inFlight.delete(policy);
    else this.inFlight.set(policy, current - 1);
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
