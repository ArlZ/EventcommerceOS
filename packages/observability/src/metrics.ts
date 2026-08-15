import { timingSafeEqual } from 'node:crypto';

export type MetricLabels = Readonly<Record<string, string>>;

type MetricType = 'counter' | 'gauge';

interface MetricSeries {
  name: string;
  help: string;
  type: MetricType;
  labels: ReadonlyArray<readonly [string, string]>;
  value: number;
}

export interface MetricsAccessConfig {
  enabled: boolean;
  bearerToken: string | null;
}

const METRIC_NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function assertMetricName(name: string): void {
  if (!METRIC_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid metric name: ${name}`);
  }
}

function normalizedLabels(labels: MetricLabels): ReadonlyArray<readonly [string, string]> {
  return Object.entries(labels)
    .map(([name, value]) => {
      if (!LABEL_NAME_PATTERN.test(name)) {
        throw new Error(`Invalid metric label name: ${name}`);
      }
      return [name, value] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
}

function seriesKey(name: string, labels: ReadonlyArray<readonly [string, string]>): string {
  return `${name}\u0000${labels.map(([label, value]) => `${label}\u0001${value}`).join('\u0002')}`;
}

function escapeHelp(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n');
}

function escapeLabelValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

function renderLabels(labels: ReadonlyArray<readonly [string, string]>): string {
  if (labels.length === 0) return '';
  return `{${labels.map(([name, value]) => `${name}="${escapeLabelValue(value)}"`).join(',')}}`;
}

function assertMetricValue(value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error('Metric values must be finite numbers');
  }
}

export class MetricRegistry {
  private readonly series = new Map<string, MetricSeries>();

  incrementCounter(
    name: string,
    help: string,
    labels: MetricLabels = {},
    amount = 1,
  ): void {
    assertMetricValue(amount);
    if (amount < 0) throw new Error('Counter increments must not be negative');
    this.mutate(name, help, 'counter', labels, (current) => current + amount);
  }

  setGauge(name: string, help: string, value: number, labels: MetricLabels = {}): void {
    assertMetricValue(value);
    this.mutate(name, help, 'gauge', labels, () => value);
  }

  render(): string {
    const grouped = new Map<string, MetricSeries[]>();
    for (const series of this.series.values()) {
      const current = grouped.get(series.name) ?? [];
      current.push(series);
      grouped.set(series.name, current);
    }

    const lines: string[] = [];
    for (const name of [...grouped.keys()].sort()) {
      const series = grouped.get(name) ?? [];
      const first = series[0];
      if (!first) continue;
      lines.push(`# HELP ${name} ${escapeHelp(first.help)}`);
      lines.push(`# TYPE ${name} ${first.type}`);
      for (const item of series.sort((left, right) =>
        seriesKey(left.name, left.labels).localeCompare(seriesKey(right.name, right.labels)),
      )) {
        lines.push(`${item.name}${renderLabels(item.labels)} ${item.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  private mutate(
    name: string,
    help: string,
    type: MetricType,
    labels: MetricLabels,
    update: (current: number) => number,
  ): void {
    assertMetricName(name);
    if (!help.trim()) throw new Error('Metric help text is required');
    const normalized = normalizedLabels(labels);
    const key = seriesKey(name, normalized);
    const existing = this.series.get(key);
    if (existing && (existing.type !== type || existing.help !== help)) {
      throw new Error(`Metric ${name} was registered with inconsistent metadata`);
    }
    const next = update(existing?.value ?? 0);
    assertMetricValue(next);
    this.series.set(key, { name, help, type, labels: normalized, value: next });
  }
}

export function metricsAccessConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MetricsAccessConfig {
  const rawEnabled = environment.METRICS_ENABLED?.trim().toLowerCase();
  if (rawEnabled && rawEnabled !== 'true' && rawEnabled !== 'false') {
    throw new Error('METRICS_ENABLED must be true or false');
  }
  const enabled = rawEnabled === 'true';
  if (!enabled) return { enabled: false, bearerToken: null };

  const bearerToken = environment.METRICS_BEARER_TOKEN?.trim() ?? '';
  if (bearerToken.length < 32) {
    throw new Error('METRICS_BEARER_TOKEN must contain at least 32 characters when metrics are enabled');
  }
  return { enabled: true, bearerToken };
}

export function metricsBearerAuthorized(
  authorizationHeader: string | undefined,
  config: MetricsAccessConfig,
): boolean {
  if (!config.enabled || !config.bearerToken) return false;
  const prefix = 'Bearer ';
  if (!authorizationHeader?.startsWith(prefix)) return false;
  const supplied = authorizationHeader.slice(prefix.length);
  const expectedBytes = Buffer.from(config.bearerToken);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
}
