import { describe, expect, it } from 'vitest';
import { posMenusReadyToOpen } from '../src/app/configuration/pos-menu-readiness';

describe('posMenusReadyToOpen', () => {
  it('requires every active sales location to have an installed latest publication', () => {
    expect(
      posMenusReadyToOpen(
        ['bar-a', 'bar-b'],
        [
          { salesLocationId: 'bar-a', installedEdges: [{ edgeId: 'edge-1' }] },
          { salesLocationId: 'bar-b', installedEdges: [{ edgeId: 'edge-1' }] },
        ],
      ),
    ).toBe(true);

    expect(
      posMenusReadyToOpen(
        ['bar-a', 'bar-b'],
        [
          { salesLocationId: 'bar-a', installedEdges: [{ edgeId: 'edge-1' }] },
          { salesLocationId: 'bar-b', installedEdges: [] },
        ],
      ),
    ).toBe(false);

    expect(
      posMenusReadyToOpen(
        ['bar-a', 'bar-b'],
        [{ salesLocationId: 'bar-a', installedEdges: [{ edgeId: 'edge-1' }] }],
      ),
    ).toBe(false);
  });

  it('does not offer the UI opening action when there are no active sales locations', () => {
    expect(posMenusReadyToOpen([], [])).toBe(false);
  });
});
