import { describe, expect, it } from 'vitest';
import {
  MetricRegistry,
  metricsAccessConfig,
  metricsBearerAuthorized,
} from '../src';

describe('MetricRegistry', () => {
  it('renders deterministic Prometheus counters and gauges', () => {
    const registry = new MetricRegistry();
    registry.incrementCounter(
      'event_commerce_http_requests_total',
      'HTTP requests processed.',
      { status_class: '2xx', method: 'GET' },
    );
    registry.incrementCounter(
      'event_commerce_http_requests_total',
      'HTTP requests processed.',
      { method: 'GET', status_class: '2xx' },
      2,
    );
    registry.setGauge(
      'event_commerce_database_ready',
      'Whether the service database is reachable.',
      1,
      { service: 'cloud-api' },
    );

    expect(registry.render()).toBe(
      [
        '# HELP event_commerce_database_ready Whether the service database is reachable.',
        '# TYPE event_commerce_database_ready gauge',
        'event_commerce_database_ready{service="cloud-api"} 1',
        '# HELP event_commerce_http_requests_total HTTP requests processed.',
        '# TYPE event_commerce_http_requests_total counter',
        'event_commerce_http_requests_total{method="GET",status_class="2xx"} 3',
        '',
      ].join('\n'),
    );
  });

  it('escapes label values and rejects malformed names or values', () => {
    const registry = new MetricRegistry();
    registry.setGauge('safe_metric', 'Safe metric.', 1, { service: 'a"b\\c\nd' });
    expect(registry.render()).toContain('service="a\\"b\\\\c\\nd"');
    expect(() => registry.setGauge('unsafe metric', 'Bad.', 1)).toThrow(/Invalid metric name/);
    expect(() => registry.setGauge('safe_metric', 'Safe metric.', Number.NaN)).toThrow(/finite/);
    expect(() => registry.incrementCounter('safe_counter', 'Safe.', {}, -1)).toThrow(/negative/);
  });

  it('rejects inconsistent metadata for the same series', () => {
    const registry = new MetricRegistry();
    registry.setGauge('same_metric', 'First help.', 1, { service: 'cloud-api' });
    expect(() =>
      registry.incrementCounter('same_metric', 'Different help.', { service: 'cloud-api' }),
    ).toThrow(/inconsistent metadata/);
  });
});

describe('metrics access configuration', () => {
  it('is disabled by default without requiring a token', () => {
    expect(metricsAccessConfig({})).toEqual({ enabled: false, bearerToken: null });
  });

  it('fails closed on malformed enablement or a weak token', () => {
    expect(() => metricsAccessConfig({ METRICS_ENABLED: 'yes' })).toThrow(/true or false/);
    expect(() =>
      metricsAccessConfig({ METRICS_ENABLED: 'true', METRICS_BEARER_TOKEN: 'too-short' }),
    ).toThrow(/at least 32/);
  });

  it('authorizes only an exact bearer token match', () => {
    const token = '0123456789abcdef0123456789abcdef';
    const config = metricsAccessConfig({
      METRICS_ENABLED: 'true',
      METRICS_BEARER_TOKEN: token,
    });
    expect(metricsBearerAuthorized(`Bearer ${token}`, config)).toBe(true);
    expect(metricsBearerAuthorized(`Bearer ${token}x`, config)).toBe(false);
    expect(metricsBearerAuthorized(undefined, config)).toBe(false);
  });
});
