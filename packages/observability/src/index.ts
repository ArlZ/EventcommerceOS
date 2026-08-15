export interface LogContext {
  correlationId?: string;
  eventId?: string;
  orderId?: string;
  deviceId?: string;
}

export interface LoggerPort {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export * from './metrics';
