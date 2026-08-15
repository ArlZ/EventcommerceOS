import { Controller, Get } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return makeHealthResponse('event-edge', new Date(), process.env.RELEASE_COMMIT);
  }
}
