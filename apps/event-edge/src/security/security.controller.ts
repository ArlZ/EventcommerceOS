import { Body, Controller, Get, Post } from '@nestjs/common';
import { EdgeRoute } from './security-route';
import { EdgeSecurityService } from './security.service';

@Controller('security')
export class EdgeSecurityController {
  constructor(private readonly security: EdgeSecurityService) {}

  @Post('snapshot')
  @EdgeRoute('SNAPSHOT_INSTALL')
  installSnapshot(@Body() body: unknown) {
    return this.security.installSnapshot(body);
  }

  @Get('status')
  status() {
    return this.security.status();
  }
}
