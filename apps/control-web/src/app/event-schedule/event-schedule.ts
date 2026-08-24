export interface EventScheduleInput {
  timezone: string;
  startsAt: string;
  endsAt: string;
}

export function canEditEventSchedule(lifecycle: string): boolean {
  return lifecycle === 'DRAFT';
}

export function validateEventSchedule(input: EventScheduleInput): EventScheduleInput {
  const timezone = input.timezone.trim();
  const startsAt = input.startsAt.trim();
  const endsAt = input.endsAt.trim();

  if (!timezone) throw new Error('Timezone is required');
  if (!startsAt) throw new Error('Start time is required');
  if (!endsAt) throw new Error('End time is required');

  const startsAtMs = Date.parse(startsAt);
  const endsAtMs = Date.parse(endsAt);
  if (Number.isNaN(startsAtMs))
    throw new Error('Start time must be a valid ISO timestamp');
  if (Number.isNaN(endsAtMs)) throw new Error('End time must be a valid ISO timestamp');
  if (endsAtMs <= startsAtMs) throw new Error('End time must be after start time');

  return { timezone, startsAt, endsAt };
}
