import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { EdgeCloudIdentity } from './edge-cloud-auth.service';

interface PublicationRow extends QueryResultRow {
  id: string;
  sales_location_id: string;
  version: string;
  checksum: string;
  published_at: Date;
}

interface ReceiptRow extends QueryResultRow {
  publication_id: string;
  edge_id: string;
  reported_at: Date;
}

interface InstallReceiptInput {
  salesLocationId: string;
  version: number;
  checksum: string;
}

export interface PosMenuPublicationInstallStatus {
  salesLocationId: string;
  version: number;
  checksum: string;
  publishedAt: string;
  installedEdges: Array<{ edgeId: string; reportedAt: string }>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseInstallations(body: unknown): InstallReceiptInput[] {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('receipt body must be an object');
  }
  const installations = (body as Record<string, unknown>).installations;
  if (!Array.isArray(installations) || installations.length < 1 || installations.length > 200) {
    throw new BadRequestException('installations must contain between 1 and 200 entries');
  }

  const scopes = new Set<string>();
  return installations.map((value, index) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(`installations[${index}] must be an object`);
    }
    const input = value as Record<string, unknown>;
    const salesLocationId = typeof input.salesLocationId === 'string' ? input.salesLocationId : '';
    const version = input.version;
    const checksum = typeof input.checksum === 'string' ? input.checksum : '';
    if (!isUuid(salesLocationId)) {
      throw new BadRequestException(`installations[${index}].salesLocationId must be a UUID`);
    }
    if (!Number.isSafeInteger(version) || (version as number) < 1) {
      throw new BadRequestException(`installations[${index}].version must be a positive safe integer`);
    }
    if (!/^[0-9a-f]{8}$/.test(checksum)) {
      throw new BadRequestException(`installations[${index}].checksum must be an 8 character lowercase hex checksum`);
    }
    const scope = `${salesLocationId}:${String(version)}`;
    if (scopes.has(scope)) throw new BadRequestException('installations contains a duplicate publication scope');
    scopes.add(scope);
    return { salesLocationId, version: version as number, checksum };
  });
}

@Injectable()
export class PosMenuInstallReceiptService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async record(
    identity: EdgeCloudIdentity,
    eventId: string,
    body: unknown,
  ): Promise<{ recorded: number }> {
    const installations = parseInstallations(body);
    return this.database.transaction(async (client) => {
      for (const installation of installations) {
        await this.recordOne(client, identity, eventId, installation);
      }
      return { recorded: installations.length };
    });
  }

  async status(eventId: string): Promise<PosMenuPublicationInstallStatus[]> {
    const publications = await this.database.query<PublicationRow>(
      `SELECT DISTINCT ON (sales_location_id)
              id::text,sales_location_id::text,version::text,checksum,published_at
       FROM pos_menu_publications
       WHERE event_id=$1
       ORDER BY sales_location_id,version DESC`,
      [eventId],
    );
    if (publications.length === 0) return [];

    const receipts = await this.database.query<ReceiptRow>(
      `SELECT publication_id::text,edge_id,reported_at
       FROM pos_menu_install_receipts
       WHERE publication_id = ANY($1::uuid[])
       ORDER BY publication_id,reported_at,edge_id`,
      [publications.map((publication) => publication.id)],
    );
    const byPublication = new Map<string, ReceiptRow[]>();
    for (const receipt of receipts) {
      const existing = byPublication.get(receipt.publication_id) ?? [];
      existing.push(receipt);
      byPublication.set(receipt.publication_id, existing);
    }

    return publications.map((publication) => {
      const version = Number(publication.version);
      if (!Number.isSafeInteger(version)) {
        throw new Error('POS menu publication version exceeds safe integer range');
      }
      return {
        salesLocationId: publication.sales_location_id,
        version,
        checksum: publication.checksum,
        publishedAt: publication.published_at.toISOString(),
        installedEdges: (byPublication.get(publication.id) ?? []).map((receipt) => ({
          edgeId: receipt.edge_id,
          reportedAt: receipt.reported_at.toISOString(),
        })),
      };
    });
  }

  private async recordOne(
    client: PoolClient,
    identity: EdgeCloudIdentity,
    eventId: string,
    installation: InstallReceiptInput,
  ): Promise<void> {
    const publication = await client.query<{ id: string }>(
      `SELECT id::text
       FROM pos_menu_publications
       WHERE organisation_id=$1
         AND event_id=$2
         AND sales_location_id=$3
         AND version=$4
         AND checksum=$5`,
      [
        identity.organisationId,
        eventId,
        installation.salesLocationId,
        installation.version,
        installation.checksum,
      ],
    );
    const publicationId = publication.rows[0]?.id;
    if (!publicationId) {
      throw new BadRequestException('installation receipt does not match an approved POS menu publication');
    }

    await client.query(
      `INSERT INTO pos_menu_install_receipts(id,publication_id,edge_id,organisation_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (publication_id,edge_id) DO NOTHING`,
      [randomUUID(), publicationId, identity.edgeId, identity.organisationId],
    );
  }
}
