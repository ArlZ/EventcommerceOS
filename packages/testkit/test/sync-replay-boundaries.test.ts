import { describe, expect, it } from 'vitest';

interface ReceiverResult {
  accepted: number;
  duplicates: number;
  businessEffects: number;
}

function receiveTwice(eventIds: readonly string[]): ReceiverResult {
  const processed = new Set<string>();
  let accepted = 0;
  let duplicates = 0;
  let businessEffects = 0;

  for (const delivery of [...eventIds, ...eventIds]) {
    if (processed.has(delivery)) {
      duplicates += 1;
      continue;
    }
    processed.add(delivery);
    accepted += 1;
    businessEffects += 1;
  }

  return { accepted, duplicates, businessEffects };
}

describe('large replay across both synchronization boundaries', () => {
  it('has one business effect at Device→Edge and Edge→Cloud after full-batch replay', () => {
    const eventIds = Array.from(
      { length: 2_500 },
      (_, index) => `order-event-${index + 1}`,
    );

    const edge = receiveTwice(eventIds);
    const cloud = receiveTwice(eventIds);

    expect(edge).toEqual({
      accepted: 2_500,
      duplicates: 2_500,
      businessEffects: 2_500,
    });
    expect(cloud).toEqual({
      accepted: 2_500,
      duplicates: 2_500,
      businessEffects: 2_500,
    });

    expect(edge.businessEffects).toBe(eventIds.length);
    expect(cloud.businessEffects).toBe(eventIds.length);
  });
});
