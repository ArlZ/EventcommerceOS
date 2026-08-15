import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';
import { EdgeDatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: EdgeDatabaseService) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    try {
      await this.database.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('service not ready');
    }
    return makeHealthResponse('event-edge', new Date(), process.env.RELEASE_COMMIT);
  }
}
