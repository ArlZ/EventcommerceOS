import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminContext } from '../configuration/admin-context';
import { DatabaseService } from '../database/database.service';

interface OperatorTargetRow {
  organisation_id: string | null;
  role: 'ADMIN' | 'PLATFORM_ADMIN';
  revoked_at: Date | string | null;
}

@Injectable()
export class CredentialAdministrationPolicyService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async assertCanRotate(
    context: AdminContext,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
  ): Promise<void> {
    if (kind !== 'operator') return;
    const target = await this.operatorTarget(credentialId);
    if (target.role === 'PLATFORM_ADMIN' && context.role !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Only a platform administrator may rotate PLATFORM_ADMIN credentials');
    }
  }

  async assertCanRevoke(
    context: AdminContext,
    kind: 'operator' | 'device' | 'edge',
    credentialId: string,
  ): Promise<void> {
    if (kind !== 'operator') return;
    const target = await this.operatorTarget(credentialId);
    if (target.role === 'PLATFORM_ADMIN' && context.role !== 'PLATFORM_ADMIN') {
      throw new ForbiddenException('Only a platform administrator may revoke PLATFORM_ADMIN credentials');
    }
    if (target.revoked_at !== null) return;

    const rows = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM security_operator_credentials
       WHERE id<>$1
         AND revoked_at IS NULL
         AND expires_at>now()
         AND (
           role='PLATFORM_ADMIN'
           OR organisation_id IS NOT DISTINCT FROM $2::uuid
         )`,
      [credentialId, target.organisation_id],
    );
    if (Number(rows[0]?.count ?? '0') === 0) {
      throw new ForbiddenException(
        'The last recoverable operator credential cannot be revoked; rotate it instead',
      );
    }
  }

  private async operatorTarget(credentialId: string): Promise<OperatorTargetRow> {
    const rows = await this.database.query<OperatorTargetRow>(
      `SELECT organisation_id::text,role,revoked_at
       FROM security_operator_credentials WHERE id=$1`,
      [credentialId],
    );
    const target = rows[0];
    if (!target) throw new NotFoundException('Security operator credential not found');
    return target;
  }
}
