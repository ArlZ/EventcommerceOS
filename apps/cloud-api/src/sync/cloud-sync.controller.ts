import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import type { DeviceCloudStatus, EdgeCloudAck } from '@event-commerce/contracts';
import {
  OperatorAuthService,
  type HeadersRecord,
} from '../auth/operator-auth.service';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { SyncDeviceHealthService } from './sync-device-health.service';
import { parseEdgeBatch } from './sync-validation';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('sync')
export class CloudSyncController {
  constructor(
    @Inject(CloudSyncService) private readonly sync: CloudSyncService,
    @Inject(EdgeCloudAuthService) private readonly edgeAuth: EdgeCloudAuthService,
    @Inject(SyncDeviceHealthService) private readonly deviceHealth: SyncDeviceHealthService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  @Get('devices')
  async devices(@Headers() headers: HeadersRecord): Promise<DeviceCloudStatus[]> {
    const organisationId = firstHeader(headers['x-organisation-id'])?.trim();
    if (!organisationId) throw new UnauthorizedException('x-organisation-id is required');

    await this.operators.contextForOrganisation(headers, organisationId, [
      'ADMIN',
      'SUPERVISOR',
      'FINANCE',
      'VIEWER',
    ]);
    return this.deviceHealth.listForOrganisation(organisationId);
  }

  @Post('edge-events')
  async ingest(@Headers() headers: HeadersRecord, @Body() body: unknown): Promise<EdgeCloudAck> {
    const identity = await this.edgeAuth.authenticate(headers);
    const batch = parseEdgeBatch(body);
    await this.edgeAuth.authorizeSyncBatch(identity, batch);
    return this.sync.ingest(batch, identity);
  }
}
