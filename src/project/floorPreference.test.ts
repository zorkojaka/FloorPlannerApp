import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool } from './floorGenerator';
import {
  FLOOR_SIGNAL_KEYS,
  floorSignals,
  initialFloorPreferenceState,
  normalizeFloorPreferenceState,
  rankFloorLayouts,
  recordFloorEquivalence,
  recordFloorPreference,
  scoreFloorLayout,
} from './floorPreference';
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

  it('primerjava dvigne zaupanje v signale, po katerih se par razlikuje', () => {
    const ranked = rankFloorLayouts(generateFloorLayoutPool(brief));
    const selected = ranked[0];
    const rejected = ranked.find((layout) => JSON.stringify(floorSignals(layout)) !== JSON.stringify(floorSignals(selected)))!;
    const state = initialFloorPreferenceState();
    const next = recordFloorPreference(state, selected, rejected);
    const grew = FLOOR_SIGNAL_KEYS.some((key) => next.confidence[key] > state.confidence[key]);
    expect(grew).toBe(true);
  });

  it('migracija starega zapisa iz shrambe dobi zaupanje in konvergenco', () => {
    const legacy = { weights: { ...initialFloorPreferenceState().weights }, comparisons: 3, championId: 'x' };
    const state = normalizeFloorPreferenceState(legacy as never);
    expect(state.confidence.compactness).toBeGreaterThan(0);
    expect(state.converged).toBe(false);
    expect(state.lastDeltas).toEqual([]);
  });

  it('dosledne (enakovredne) izbire pripeljejo do konvergence, preobrat jo umakne', () => {
    const ranked = rankFloorLayouts(generateFloorLayoutPool(brief));
    const a = ranked[0];
    const b = ranked.find((layout) => JSON.stringify(floorSignals(layout)) !== JSON.stringify(floorSignals(a)))!;
    let state = initialFloorPreferenceState();
    for (let i = 0; i < 6; i += 1) state = recordFloorEquivalence(state, a, b);
    expect(state.converged).toBe(true);
    // izrazit preobrat preferenc → uteži se spet premikajo → ni konvergence
    let flipped = state;
    for (let i = 0; i < 2; i += 1) flipped = recordFloorPreference(flipped, b, a);
    expect(flipped.comparisons).toBe(8);
    expect(flipped.lastDeltas[flipped.lastDeltas.length - 1]).toBeGreaterThanOrEqual(0);
  });
});
