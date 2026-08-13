import { describe, expect, it } from 'vitest';
import { asEntityId } from '../src';

describe('asEntityId', () => {
  it('rejects empty identifiers', () => {
    expect(() => asEntityId('   ')).toThrow('must not be empty');
  });
});
