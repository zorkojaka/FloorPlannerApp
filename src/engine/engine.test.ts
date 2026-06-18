import { describe, expect, it } from 'vitest';
import { baseLib } from '../elements/library';
import { orientation, serviceSides } from '../elements/model';
import type { PlacedElement, PlacedFixture } from './evaluator';
import { evalPlace } from './evaluator';
import { checkFeasibility } from './feasibility';
import { doorRects, overlapArea, placeRects } from './geometry';
import { generateLayoutPool } from './generator';
import { placedConnectionPoint, routeServices } from './routing';
import { initialPreferenceState, recordPreference } from './preference';
import type { LayoutCandidate } from './generator';
import { applyInducedRules, induceRules } from '../rules/induction';
import { measureGeneralization, measureInductionHoldout, measurePreferenceGain } from './metrics';
import { loadJson, saveJson, type JsonStorage } from '../shared/storage';

describe('element orientation', () => {
  it('derives service sides only from wall-routed connections', () => {
    const library = baseLib();

    expect(serviceSides(library.toilet)).toEqual(['back']);
    expect(orientation(library.toilet)).toMatchObject({ warn: false, corner: false });
  });

  it('marks opposite wall connections as physically impossible', () => {
    const library = baseLib();
    const sink = {
      ...library.sink,
      conns: [
        { ...library.sink.conns[0], side: 'back' as const },
        { ...library.sink.conns[1], side: 'front' as const },
      ],
    };

    expect(orientation(sink)).toMatchObject({ warn: true, corner: false });
  });
});

describe('layout geometry', () => {
  it('computes overlapping area deterministically', () => {
    expect(overlapArea({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 })).toBe(2500);
    expect(overlapArea({ x: 0, y: 0, w: 100, h: 100 }, { x: 120, y: 120, w: 100, h: 100 })).toBe(0);
  });
});

describe('layout evaluation', () => {
  it('rejects fixtures in the inward door swing', () => {
    const library = baseLib();
    const door = doorRects(library.door, 'N', 0, 0, 'inward', 2000, 2200);
    const sink = placeRects(library.sink, 'N', 100, 2000, 2200);
    const placed: PlacedElement[] = [
      { ...door, el: library.door, name: library.door.name },
      { ...sink, el: library.sink, wall: 'N', name: library.sink.name },
    ];

    const result = evalPlace(placed, { W: 2000, D: 2200, wetWall: 'S', minAisle: 800 }, true);

    expect(result.valid).toBe(false);
    expect(result.viol).toContain('vrata se odpirajo na opremo (Umivalnik)');
  });

  it('generates valid candidates for the default WC program', () => {
    const library = baseLib();
    const pool = generateLayoutPool({
      library,
      program: [
        { id: 'door', key: 'door', w: 800, dir: 'auto', wall: 'auto', hinge: 'auto' },
        { id: 'toilet', key: 'toilet' },
        { id: 'sink', key: 'sink' },
      ],
      cfg: { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 },
      soft: true,
      samples: 250,
    });

    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((candidate) => candidate.ev.valid)).toBe(true);
  });
});

describe('service routing', () => {
  it('routes from the actual placed connection point', () => {
    const library = baseLib();
    const toilet = placeRects(library.toilet, 'S', 200, 1900, 2200);
    const placedToilet: PlacedFixture = { ...toilet, el: library.toilet, wall: 'S', name: library.toilet.name };
    const waterIn = library.toilet.conns.find((connection) => connection.type === 'water-in')!;

    const point = placedConnectionPoint(placedToilet, waterIn);

    expect(point).toEqual({ x: 300, y: 2200 });
  });

  it('changes route length when the wet wall changes', () => {
    const library = baseLib();
    const toilet = placeRects(library.toilet, 'S', 200, 1900, 2200);
    const placed: PlacedElement[] = [{ ...toilet, el: library.toilet, wall: 'S', name: library.toilet.name }];

    const south = routeServices(placed, { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 });
    const north = routeServices(placed, { W: 1900, D: 2200, wetWall: 'N', minAisle: 800 });

    expect(south.totalLength).toBeLessThan(north.totalLength);
  });

  it('marks floor routes as blocked when slab policy disallows them', () => {
    const library = baseLib();
    const toilet = placeRects(library.toilet, 'S', 200, 1900, 2200);
    const placed: PlacedElement[] = [{ ...toilet, el: library.toilet, wall: 'S', name: library.toilet.name }];

    const result = routeServices(placed, { W: 1900, D: 2200, wetWall: 'N', minAisle: 800 }, { allowFloorRoutes: false });

    expect(result.blockedCount).toBe(1);
    expect(result.routes.find((route) => route.connection.routesTo === 'floor')?.blocked).toBe(true);
  });
});

describe('brief feasibility', () => {
  it('rejects a room without doors before generation', () => {
    const library = baseLib();
    const result = checkFeasibility(library, [{ id: 'toilet', key: 'toilet' }], {
      W: 1900,
      D: 2200,
      wetWall: 'S',
      minAisle: 800,
    });

    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('soba nima vrat');
  });

  it('rejects fixed doors that do not fit the selected wall', () => {
    const library = baseLib();
    const result = checkFeasibility(library, [{ id: 'door', key: 'door', w: 2300, wall: 'N' }], {
      W: 1900,
      D: 2200,
      wetWall: 'S',
      minAisle: 800,
    });

    expect(result.feasible).toBe(false);
    expect(result.reasons).toContain('vrata Vrata se ne prilegajo izbranemu zidu');
  });

  it('prevents sampling when feasibility fails', () => {
    const library = baseLib();
    const pool = generateLayoutPool({
      library,
      program: [{ id: 'toilet', key: 'toilet' }],
      cfg: { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 },
      soft: true,
      samples: 250,
    });

    expect(pool).toEqual([]);
  });
});

describe('preference learning', () => {
  it('moves weights toward the repeatedly preferred signal and reports convergence', () => {
    const selected = candidateWith({ halo: 0, drain: 2200, score: 0.7 });
    const rejected = candidateWith({ halo: 800000, drain: 1800, score: 0.6 });
    let state = initialPreferenceState();

    for (let i = 0; i < 5; i += 1) {
      state = recordPreference(state, selected, rejected);
    }

    expect(state.weights.halo).toBeGreaterThan(0.5);
    expect(state.converged).toBe(true);
    expect(state.comparisons).toBe(5);
  });
});

describe('rule induction', () => {
  it('derives higher confidence from low-variance references', () => {
    const lowVariance = induceRules([
      { ref: 'a', elementKey: 'toilet', parameter: 'clearance-front', value: 650 },
      { ref: 'b', elementKey: 'toilet', parameter: 'clearance-front', value: 660 },
      { ref: 'c', elementKey: 'toilet', parameter: 'clearance-front', value: 670 },
    ]);
    const highVariance = induceRules([
      { ref: 'a', elementKey: 'toilet', parameter: 'clearance-front', value: 500 },
      { ref: 'b', elementKey: 'toilet', parameter: 'clearance-front', value: 900 },
      { ref: 'c', elementKey: 'toilet', parameter: 'clearance-front', value: 1200 },
    ]);

    expect(lowVariance[0].envelope.conf).toBeGreaterThan(highVariance[0].envelope.conf);
  });

  it('changes generated envelopes when references change', () => {
    const compact = induceRules([
      { ref: 'compact-a', elementKey: 'sink', parameter: 'clearance-front', value: 500 },
      { ref: 'compact-b', elementKey: 'sink', parameter: 'clearance-front', value: 520 },
    ]);
    const generous = induceRules([
      { ref: 'generous-a', elementKey: 'sink', parameter: 'clearance-front', value: 800 },
      { ref: 'generous-b', elementKey: 'sink', parameter: 'clearance-front', value: 840 },
    ]);

    expect(compact[0].envelope.halo).toBeLessThan(generous[0].envelope.halo);
  });

  it('applies induced clearance rules to the element library', () => {
    const library = baseLib();
    const rules = induceRules([
      { ref: 'r1', elementKey: 'toilet', parameter: 'clearance-front', value: 760 },
      { ref: 'r2', elementKey: 'toilet', parameter: 'clearance-front', value: 780 },
    ]);

    const next = applyInducedRules(library, rules);

    expect(next.toilet.clear.halo).not.toBe(library.toilet.clear.halo);
    expect(next.toilet.source).toBe('ifc');
  });
});

describe('MVP metrics', () => {
  it('reports holdout induction quality as a bounded score', () => {
    const metric = measureInductionHoldout([
      { ref: 'a', elementKey: 'toilet', parameter: 'clearance-front', value: 650 },
      { ref: 'b', elementKey: 'toilet', parameter: 'clearance-front', value: 670 },
      { ref: 'c', elementKey: 'toilet', parameter: 'clearance-front', value: 690 },
      { ref: 'd', elementKey: 'toilet', parameter: 'clearance-front', value: 700 },
    ]);

    expect(metric.holdoutCount).toBeGreaterThan(0);
    expect(metric.score).toBeGreaterThanOrEqual(0);
    expect(metric.score).toBeLessThanOrEqual(1);
  });

  it('reports a positive generalization score when rules are induced', () => {
    const metric = measureGeneralization([
      { ref: 'a', elementKey: 'toilet', parameter: 'clearance-front', value: 650 },
      { ref: 'b', elementKey: 'sink', parameter: 'clearance-front', value: 550 },
      { ref: 'c', elementKey: 'urinal', parameter: 'clearance-front', value: 600 },
    ]);

    expect(metric.ruleCount).toBe(3);
    expect(metric.score).toBeGreaterThan(0);
  });

  it('reports preference gain after A/B learning moves weights', () => {
    let state = initialPreferenceState();
    state = recordPreference(state, candidateWith({ halo: 0, drain: 2000, score: 0.8 }), candidateWith({ halo: 500000, drain: 1900, score: 0.7 }));

    expect(measurePreferenceGain(state)).toBeGreaterThan(0);
  });
});

describe('JSON storage', () => {
  it('round-trips JSON values through a Storage-like adapter', () => {
    const storage = memoryStorage();

    saveJson(storage, 'project', { W: 1900, wetWall: 'S' });

    expect(loadJson(storage, 'project', { W: 0 })).toEqual({ W: 1900, wetWall: 'S' });
  });

  it('returns fallback for invalid JSON', () => {
    const storage = memoryStorage();
    storage.setItem('bad', '{not-json');

    expect(loadJson(storage, 'bad', { ok: true })).toEqual({ ok: true });
  });
});

function memoryStorage(): JsonStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

function candidateWith(ev: { halo: number; drain: number; score: number }): LayoutCandidate {
  return {
    placed: [],
    ev: {
      valid: true,
      viol: [],
      halo: ev.halo,
      overlaps: [],
      aisle: 1000,
      drain: ev.drain,
      score: ev.score,
    },
  };
}
