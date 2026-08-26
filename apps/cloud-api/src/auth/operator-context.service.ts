import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  OperatorAuthService,
  type HeadersRecord,
  type OperatorOrganisationRole,
} from './operator-auth.service';

type EventLifecycle = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';

interface ContextRow extends QueryResultRow {
  organisation_id: string;
  organisation_name: string;
  role: OperatorOrganisationRole | 'PLATFORM_ADMIN';
  event_id: string | null;
  event_name: string | null;
  event_lifecycle: EventLifecycle | null;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
}

export interface OperatorContextEvent {
  id: string;
  name: string;
  lifecycle: EventLifecycle;
  startsAt: string;
  endsAt: string;
}

export interface OperatorContextOrganisation {
  id: string;
  name: string;
  role: OperatorOrganisationRole | 'PLATFORM_ADMIN';
  events: OperatorContextEvent[];
}

export interface OperatorControlContext {
  organisations: OperatorContextOrganisation[];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

@Injectable()
export class OperatorContextService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OperatorAuthService) private readonly operators: OperatorAuthService,
  ) {}

  async context(headers: HeadersRecord): Promise<OperatorControlContext> {
    const identity = await this.operators.authenticate(headers);
    const rows = identity.platformAdmin
      ? await this.database.query<ContextRow>(
          `SELECT organisation.id::text AS organisation_id,
                  organisation.name AS organisation_name,
                  'PLATFORM_ADMIN'::text AS role,
                  event.id::text AS event_id,
                  event.name AS event_name,
                  event.lifecycle AS event_lifecycle,
                  event.starts_at,
                  event.ends_at
           FROM organisations organisation
           LEFT JOIN events event
             ON event.organisation_id=organisation.id
            AND event.lifecycle <> 'ARCHIVED'
           WHERE organisation.lifecycle='ACTIVE'
           ORDER BY organisation.name ASC,event.starts_at DESC NULLS LAST,event.name ASC`,
        )
      : await this.database.query<ContextRow>(
          `SELECT organisation.id::text AS organisation_id,
                  organisation.name AS organisation_name,
                  membership.role,
                  event.id::text AS event_id,
                  event.name AS event_name,
                  event.lifecycle AS event_lifecycle,
                  event.starts_at,
                  event.ends_at
           FROM operator_memberships membership
           JOIN organisations organisation
             ON organisation.id=membership.organisation_id
            AND organisation.lifecycle='ACTIVE'
           LEFT JOIN events event
             ON event.organisation_id=organisation.id
            AND event.lifecycle <> 'ARCHIVED'
           WHERE membership.actor_id=$1
             AND membership.status='ACTIVE'
           ORDER BY organisation.name ASC,event.starts_at DESC NULLS LAST,event.name ASC`,
          [identity.actorId],
        );

    const organisations = new Map<string, OperatorContextOrganisation>();
    for (const row of rows) {
      let organisation = organisations.get(row.organisation_id);
      if (!organisation) {
        organisation = {
          id: row.organisation_id,
          name: row.organisation_name,
          role: row.role,
          events: [],
        };
        organisations.set(row.organisation_id, organisation);
      }
      if (
        row.event_id &&
        row.event_name &&
        row.event_lifecycle &&
        row.starts_at !== null &&
        row.ends_at !== null
      ) {
        organisation.events.push({
          id: row.event_id,
          name: row.event_name,
          lifecycle: row.event_lifecycle,
          startsAt: iso(row.starts_at),
          endsAt: iso(row.ends_at),
        });
      }
    }

    return { organisations: [...organisations.values()] };
  }
}
