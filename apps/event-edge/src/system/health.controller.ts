import { Controller, Get } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';
import { EdgeRoute } from '../security/security-route';

@Controller('health')
@EdgeRoute('PUBLIC_HEALTH')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return makeHealthResponse('event-edge');
  }
}
