import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool } from './floorGenerator';
import {
  floorPairInformation,
  nextFloorPairs,
  poolDiversity,
  structuralFamilies,
  suggestedFloorExplore,
} from './floorActive';
import {
  FLOOR_SIGNAL_KEYS,
  floorSignals,
  initialFloorPreferenceState,
  rankFloorLayouts,
  recordFloorPreference,
} from './floorPreference';
import type { FloorLayout } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

const brief: ProjectBrief = {
  id: 'demo-active',
  name: 'Demo active learning',
  boundary: { area: 240, width: 20, depth: 12 },
  corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
  rooms: [
    { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
    { id: 'wc-women', type: 'wc', wcKind: 'female', count: 1 },
    { id: 'office', type: 'office', count: 5, workstations: 1 },
    { id: 'corridor', type: 'corridor', count: 1 },
  ],
};

function signalDistance(a: FloorLayout, b: FloorLayout): number {
  const sa = floorSignals(a);
  const sb = floorSignals(b);
  return Math.sqrt(FLOOR_SIGNAL_KEYS.reduce((sum, key) => sum + (sa[key] - sb[key]) ** 2, 0));
}

describe('aktivni A/B izbor na nivoju etaže (FP-001)', () => {
  const pool = generateFloorLayoutPool(brief);
  const ranked = rankFloorLayouts(pool);

  it('prvi pari so bolj raznoliki kot baseline prvak-vs-naslednji', () => {
    const state = initialFloorPreferenceState();
    const active = nextFloorPairs(ranked, state, 1, 5);
    expect(active.length).toBe(5);
    const activeAvg = active.reduce((sum, pair) => sum + signalDistance(pair.a, pair.b), 0) / active.length;
    // baseline: prvak proti kandidatom po rangu (stara logika koraka 2)
    const champion = ranked[0];
    const baseline = ranked.slice(1, 6).map((challenger) => signalDistance(champion, challenger));
    const baselineAvg = baseline.reduce((sum, value) => sum + value, 0) / baseline.length;
    expect(activeAvg).toBeGreaterThan(baselineAvg);
  });

  it('informacijski donos para je viden in pada z zaupanjem', () => {
    let state = initialFloorPreferenceState();
    const [first] = nextFloorPairs(ranked, state, 1, 1);
    const before = floorPairInformation(first.a, first.b, state);
    expect(before).toBeGreaterThan(0);
    state = recordFloorPreference(state, first.a, first.b);
    const after = floorPairInformation(first.a, first.b, state);
    expect(after).toBeLessThan(before);
  });

  it('pri izkoriščanju (explore=0) vrne par visoke kvalitete', () => {
    const state = initialFloorPreferenceState();
    const pairs = nextFloorPairs(ranked, state, 0, 1);
    const allPairs = nextFloorPairs(ranked, state, 0, 10_000);
    const maxQuality = Math.max(...allPairs.map((pair) => pair.quality));
    expect(pairs[0].quality).toBeGreaterThanOrEqual(maxQuality - 1e-9);
  });

  it('predlagano raziskovanje pada s primerjavami', () => {
    expect(suggestedFloorExplore(0)).toBe(1);
    expect(suggestedFloorExplore(5)).toBeLessThan(1);
    expect(suggestedFloorExplore(20)).toBe(0);
  });
});

describe('raznolikost bazena kandidatov (FP-002)', () => {
  const pool = generateFloorLayoutPool(brief);

  it('bazen vsebuje vsaj 3 strukturno različne družine', () => {
    const families = structuralFamilies(pool);
    expect(families.size).toBeGreaterThanOrEqual(3);
  });

  it('bazen nima podvojenih kandidatov in ima merjeno raznolikost', () => {
    expect(new Set(pool.map((layout) => layout.id)).size).toBe(pool.length);
    const diversity = poolDiversity(pool);
    expect(diversity).toBeGreaterThan(0);
    expect(diversity).toBeLessThanOrEqual(1);
  });

  it('vsiljeno število hodnikov ustvari drugačno topologijo', () => {
    const keys = new Set(pool.map((layout) => 1 + layout.corridorLinks.filter((c) => c.id.startsWith('corridor-main')).length));
    expect(keys.size).toBeGreaterThanOrEqual(2);
  });

  it('vsi kandidati ostanejo veljavni (vrata na hodnik)', () => {
    expect(pool.every((layout) => layout.rooms.every((room) => room.doorSide))).toBe(true);
  });
});
