export class DeterministicRandom {
  private state: number;

  constructor(seed: number) {
    const normalized = seed >>> 0;
    this.state = normalized === 0 ? 0x6d2b79f5 : normalized;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    this.state >>>= 0;
    return value;
  }

  integer(minInclusive: number, maxInclusive: number): number {
    if (maxInclusive < minInclusive) throw new Error('invalid random integer range');
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  weighted<T>(items: readonly T[], weight: (item: T) => number): T {
    if (items.length === 0) throw new Error('weighted selection requires at least one item');
    const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
    if (total <= 0) throw new Error('weighted selection requires positive total weight');
    let cursor = this.next() * total;
    for (const item of items) {
      cursor -= Math.max(0, weight(item));
      if (cursor <= 0) return item;
    }
    return items[items.length - 1]!;
  }
}
