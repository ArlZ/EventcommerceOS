import { Controller, Get } from '@nestjs/common';
import { makeHealthResponse, type HealthResponse } from '@event-commerce/contracts';
import { SecurityRoute } from '../security/security-route';

@Controller('health')
@SecurityRoute('PUBLIC_HEALTH')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return makeHealthResponse('cloud-api');
  }
}
