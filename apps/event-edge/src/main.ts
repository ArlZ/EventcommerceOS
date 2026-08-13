import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  return port;
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  await app.listen(parsePort(process.env.PORT, 3002));
}

void bootstrap();
