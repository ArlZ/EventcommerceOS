import { Body, Controller, Get, Headers, Inject, Post, UnauthorizedException } from '@nestjs/common';
import {
  EdgeLocalAdminAuthService,
  type EdgeLocalAdminHeaders,
} from '../security/edge-local-admin-auth.service';
import { DeviceEdgeAuthService } from '../security/device-edge-auth.service';
import { PosMenuService } from './pos-menu.service';
import type { PosMenuSnapshot } from './pos-menu.types';
import { parsePosMenuSnapshot } from './pos-menu.validation';

type HeadersRecord = Record<string, string | string[] | undefined>;

@Controller('pos-menu')
export class PosMenuController {
  constructor(
    @Inject(EdgeLocalAdminAuthService) private readonly localAdmin: EdgeLocalAdminAuthService,
    @Inject(DeviceEdgeAuthService) private readonly deviceAuth: DeviceEdgeAuthService,
    @Inject(PosMenuService) private readonly menus: PosMenuService,
  ) {}

  @Post('snapshot')
  async install(
    @Headers() headers: EdgeLocalAdminHeaders,
    @Body() body: unknown,
  ): Promise<PosMenuSnapshot> {
    this.localAdmin.authorize(headers);
    return this.menus.install(parsePosMenuSnapshot(body));
  }

  @Get('current')
  async current(@Headers() headers: HeadersRecord): Promise<PosMenuSnapshot> {
    const identity = await this.deviceAuth.authenticate(headers);
    if (!identity.salesLocationId) {
      throw new UnauthorizedException('POS device is not assigned to a sales location');
    }
    return this.menus.current(identity.eventId, identity.salesLocationId);
  }
}
