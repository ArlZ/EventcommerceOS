import 'reflect-metadata';
import { ShutdownSignal } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function abuseDeploymentMode(trustProxyHops: number): void {
  const mode = process.env.ABUSE_DEPLOYMENT_MODE?.trim();
  if (process.env.NODE_ENV !== 'production' && !mode) return;
  if (mode !== 'single_instance_pilot' && mode !== 'upstream_distributed') {
    throw new Error(
      'ABUSE_DEPLOYMENT_MODE must be single_instance_pilot or upstream_distributed in production',
    );
  }
  if (mode === 'upstream_distributed') {
    if (process.env.ABUSE_UPSTREAM_CONFIRMED !== 'true') {
      throw new Error(
        'ABUSE_UPSTREAM_CONFIRMED=true is required for upstream_distributed deployment mode',
      );
    }
    if (trustProxyHops < 1) {
      throw new Error('TRUST_PROXY_HOPS must be at least 1 for upstream_distributed mode');
    }
  }
}

async function bootstrap(): Promise<void> {
  const trustProxyHops = boundedInteger('TRUST_PROXY_HOPS', 0, 0, 5);
  abuseDeploymentMode(trustProxyHops);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.enableShutdownHooks([ShutdownSignal.SIGTERM, ShutdownSignal.SIGINT]);
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  const jsonBodyLimit = boundedInteger('HTTP_JSON_BODY_LIMIT_BYTES', 1_048_576, 65_536, 2_097_152);
  const urlencodedBodyLimit = boundedInteger(
    'HTTP_URLENCODED_BODY_LIMIT_BYTES',
    65_536,
    16_384,
    262_144,
  );
  app.useBodyParser('json', { limit: jsonBodyLimit });
  app.useBodyParser('urlencoded', { limit: urlencodedBodyLimit, extended: false });

  app.enableCors({
    origin: process.env.CONTROL_WEB_ORIGIN ?? 'http://localhost:3000',
    allowedHeaders: ['authorization', 'content-type', 'x-organisation-id'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
  });

  const requestTimeoutMs = boundedInteger('HTTP_REQUEST_TIMEOUT_MS', 30_000, 5_000, 120_000);
  const headersTimeoutMs = boundedInteger('HTTP_HEADERS_TIMEOUT_MS', 10_000, 1_000, 60_000);
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error('HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS');
  }
  const keepAliveTimeoutMs = boundedInteger('HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, 1_000, 30_000);

  const server = await app.listen(parsePort(process.env.PORT, 3001));
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.maxHeadersCount = boundedInteger('HTTP_MAX_HEADERS_COUNT', 100, 20, 200);
}

void bootstrap();
