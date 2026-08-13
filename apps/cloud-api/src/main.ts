import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors({
    origin: process.env.CONTROL_WEB_ORIGIN ?? 'http://localhost:3000',
    allowedHeaders: ['content-type', 'x-actor-id', 'x-role', 'x-organisation-id'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'OPTIONS'],
  });
  await app.listen(parsePort(process.env.PORT, 3001));
}

void bootstrap();
