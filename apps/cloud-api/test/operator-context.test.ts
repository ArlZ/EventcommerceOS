import { describe, expect, it, vi } from 'vitest';
import { OperatorContextService } from '../src/auth/operator-context.service';

const actorId = '11111111-1111-4111-8111-111111111111';

describe('operator control context', () => {
  it('limits organisation and event choices to active memberships for ordinary operators', async () => {
    const operators = {
      authenticate: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        actorId,
        platformAdmin: false,
      }),
    };
    const database = {
      query: vi.fn().mockResolvedValue([
        {
          organisation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          organisation_name: 'Pilot Org',
          role: 'ADMIN',
          event_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          event_name: 'Pilot Event',
          event_lifecycle: 'ACTIVE',
          starts_at: '2026-08-26T08:00:00.000Z',
          ends_at: '2026-08-26T18:00:00.000Z',
        },
      ]),
    };

    const service = new OperatorContextService(database as never, operators as never);
    await expect(service.context({ cookie: 'ec_operator_session=ecom_op_test' })).resolves.toEqual({
      organisations: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'Pilot Org',
          role: 'ADMIN',
          events: [
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              name: 'Pilot Event',
              lifecycle: 'ACTIVE',
              startsAt: '2026-08-26T08:00:00.000Z',
              endsAt: '2026-08-26T18:00:00.000Z',
            },
          ],
        },
      ],
    });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('operator_memberships'), [
      actorId,
    ]);
  });

  it('uses the platform-wide query only for authenticated platform administrators', async () => {
    const operators = {
      authenticate: vi.fn().mockResolvedValue({
        sessionId: 'session-2',
        actorId,
        platformAdmin: true,
      }),
    };
    const database = { query: vi.fn().mockResolvedValue([]) };

    const service = new OperatorContextService(database as never, operators as never);
    await expect(service.context({ authorization: 'Bearer ecom_op_test' })).resolves.toEqual({
      organisations: [],
    });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("'PLATFORM_ADMIN'::text"));
  });
});
