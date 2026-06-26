import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool } from './floorGenerator';
import { floorSignals, initialFloorPreferenceState, rankFloorLayouts, recordFloorPreference, scoreFloorLayout } from './floorPreference';
import type { ProjectBrief } from './roomTypes';

describe('floor layout preference learning', () => {
  const brief: ProjectBrief = {
    id: 'demo-floor-pref',
    name: 'Demo floor preferences',
    boundary: { area: 80, width: 10, depth: 8 },
    rooms: [
      { id: 'wc', type: 'wc', count: 1 },
      { id: 'office', type: 'office', count: 2 },
      { id: 'corridor', type: 'corridor', count: 1 },
    ],
  };

  it('ranks floor layout candidates with explicit scores', () => {
    const ranked = rankFloorLayouts(generateFloorLayoutPool(brief));
    expect(ranked.length).toBeGreaterThan(1);
    expect(scoreFloorLayout(ranked[0])).toBeGreaterThanOrEqual(scoreFloorLayout(ranked[1]));
  });

  it('updates learned floor weights when the user picks a better floor candidate', () => {
    const ranked = rankFloorLayouts(generateFloorLayoutPool(brief));
    const selected = ranked[0];
    const rejected = ranked.find((layout) => JSON.stringify(floorSignals(layout)) !== JSON.stringify(floorSignals(selected)))!;
    const state = initialFloorPreferenceState();
    const next = recordFloorPreference(state, selected, rejected);
    expect(next.comparisons).toBe(1);
    expect(next.championId).toBe(selected.id);
    expect(next.weights).not.toEqual(state.weights);
  });
});
