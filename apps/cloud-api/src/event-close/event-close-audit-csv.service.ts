import { Injectable } from '@nestjs/common';
import type { EventCloseActionView, EventCloseReport } from '@event-commerce/contracts';
import type { EventCloseService } from './event-close.service';

@Injectable()
export class EventCloseAuditCsvService {
  constructor(private readonly close: EventCloseService) {}

  render(report: EventCloseReport, actions: EventCloseActionView[]): string {
    const base = this.close.csv(report).trimEnd();
    const auditRows = actions.map((action) =>
      [
        'CLOSE_ACTION',
        action.action,
        action.actionId,
        '',
        action.actorId,
        action.reportId ?? '',
        action.closeRevision === null ? '' : String(action.closeRevision),
        `${action.createdAt} • ${action.reason}`,
      ]
        .map(this.csvCell)
        .join(','),
    );
    return `${base}${auditRows.length > 0 ? `\n${auditRows.join('\n')}` : ''}\n`;
  }

  private csvCell(value: string): string {
    if (!/[",\n\r]/.test(value)) return value;
    return `"${value.replaceAll('"', '""')}"`;
  }
}
