import 'reflect-metadata';
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
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useBodyParser('json', {
    limit: boundedInteger('EDGE_HTTP_JSON_BODY_LIMIT_BYTES', 1_048_576, 65_536, 2_097_152),
  });
  app.useBodyParser('urlencoded', {
    limit: boundedInteger('EDGE_HTTP_URLENCODED_BODY_LIMIT_BYTES', 65_536, 16_384, 262_144),
    extended: false,
  });

  const requestTimeoutMs = boundedInteger('EDGE_HTTP_REQUEST_TIMEOUT_MS', 15_000, 5_000, 60_000);
  const headersTimeoutMs = boundedInteger('EDGE_HTTP_HEADERS_TIMEOUT_MS', 5_000, 1_000, 30_000);
  if (headersTimeoutMs > requestTimeoutMs) {
    throw new Error('EDGE_HTTP_HEADERS_TIMEOUT_MS must not exceed EDGE_HTTP_REQUEST_TIMEOUT_MS');
  }

  const server = await app.listen(parsePort(process.env.PORT, 3002));
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = headersTimeoutMs;
  server.keepAliveTimeout = boundedInteger('EDGE_HTTP_KEEP_ALIVE_TIMEOUT_MS', 5_000, 1_000, 30_000);
  server.maxHeadersCount = boundedInteger('EDGE_HTTP_MAX_HEADERS_COUNT', 100, 20, 200);
}

void bootstrap();
