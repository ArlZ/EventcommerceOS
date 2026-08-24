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
import { OperatorAuthService, type HeadersRecord } from '../auth/operator-auth.service';
import { CloudSyncService } from './cloud-sync.service';
import { EdgeCloudAuthService } from './edge-cloud-auth.service';
import { SyncDeviceHealthService } from './sync-device-health.service';
import { parseEdgeBatch } from './sync-validation';

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function withPostDeliveryStatus(batch: ReturnType<typeof parseEdgeBatch>) {
  const deliveredByDevice = new Map<string, number>();
  for (const event of batch.events) {
    deliveredByDevice.set(event.deviceId, (deliveredByDevice.get(event.deviceId) ?? 0) + 1);
  }

  const deliveredAt = new Date().toISOString();
  return {
    ...batch,
    deviceStatuses: batch.deviceStatuses.map((status) => {
      const delivered = deliveredByDevice.get(status.deviceId) ?? 0;
      if (delivered === 0) return status;
      return {
        ...status,
        edgeBacklogCount: Math.max(0, status.edgeBacklogCount - delivered),
        lastCloudDeliveryAt: deliveredAt,
      };
    }),
  };
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
    return this.sync.ingest(withPostDeliveryStatus(batch), identity);
  }
}
