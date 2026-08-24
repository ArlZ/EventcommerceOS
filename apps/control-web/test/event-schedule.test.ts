import { describe, expect, it } from 'vitest';
import {
  canEditEventSchedule,
  validateEventSchedule,
} from '../src/app/event-schedule/event-schedule';

describe('event schedule controls', () => {
  it('allows schedule editing only while the event is DRAFT', () => {
    expect(canEditEventSchedule('DRAFT')).toBe(true);
    expect(canEditEventSchedule('ACTIVE')).toBe(false);
    expect(canEditEventSchedule('CLOSED')).toBe(false);
    expect(canEditEventSchedule('ARCHIVED')).toBe(false);
  });

  it('accepts a valid Nairobi pilot window', () => {
    expect(
      validateEventSchedule({
        timezone: ' Africa/Nairobi ',
        startsAt: '2026-08-26T18:00:00+03:00',
        endsAt: '2026-08-27T02:00:00+03:00',
      }),
    ).toEqual({
      timezone: 'Africa/Nairobi',
      startsAt: '2026-08-26T18:00:00+03:00',
      endsAt: '2026-08-27T02:00:00+03:00',
    });
  });

  it('rejects a trading window that ends before it starts', () => {
    expect(() =>
      validateEventSchedule({
        timezone: 'Africa/Nairobi',
        startsAt: '2026-08-27T02:00:00+03:00',
        endsAt: '2026-08-26T18:00:00+03:00',
      }),
    ).toThrow('End time must be after start time');
  });

  it('rejects invalid timestamps before calling Cloud', () => {
    expect(() =>
      validateEventSchedule({
        timezone: 'Africa/Nairobi',
        startsAt: 'not-a-time',
        endsAt: '2026-08-27T02:00:00+03:00',
      }),
    ).toThrow('Start time must be a valid ISO timestamp');
  });
});
