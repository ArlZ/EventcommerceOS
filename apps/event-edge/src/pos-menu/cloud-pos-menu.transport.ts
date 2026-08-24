import { Injectable } from '@nestjs/common';
import { edgeCloudRequestCredentials } from '../security/edge-cloud-credentials';
import type { PosMenuSnapshot } from './pos-menu.types';
import { parsePosMenuSnapshot } from './pos-menu.validation';

@Injectable()
export class CloudPosMenuTransport {
  async latest(eventId: string): Promise<PosMenuSnapshot[]> {
    const endpoint = this.endpoint(eventId);
    const credentials = edgeCloudRequestCredentials();
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        ...credentials.headers,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`cloud POS menu publication returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body) || body.length === 0) {
      throw new Error('cloud POS menu publication response must contain at least one snapshot');
    }
    return body.map((value) => parsePosMenuSnapshot(value));
  }

  endpoint(eventId: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId)) {
      throw new Error('eventId must be a UUID');
    }
    const syncUrl = process.env.CLOUD_SYNC_URL ?? 'http://localhost:3001/sync/edge-events';
    const parsed = new URL(syncUrl);
    const loopback =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !loopback) {
      throw new Error('cloud sync URL must use HTTPS outside loopback development');
    }
    if (parsed.search || parsed.hash || !parsed.pathname.endsWith('/sync/edge-events')) {
      throw new Error('CLOUD_SYNC_URL must end with /sync/edge-events without query or fragment');
    }
    const prefix = parsed.pathname.slice(0, -'/sync/edge-events'.length);
    parsed.pathname = `${prefix}/sync/events/${eventId}/pos-menu-publications`;
    return parsed.toString();
  }
}
