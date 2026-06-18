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
import { defaultChannels, effectiveWeight, learnChannelsFromPreference, rankByChannels } from './channels';
import { collides3D, humanUsageBox, overlapVolume } from './volume';
import { buildFreeGrid, corridorWidth, reachable } from './freespace';
import { nextPair, pairInformation, suggestedExplore } from './active';
import { fromRoomConstraints, type RoomConstraints } from '../constraints/brief';

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

describe('channel test bench', () => {
  it('mixes prior and learned weight by confidence', () => {
    const channel = { ...defaultChannels()[0], prior: 0.8, learned: 0.2, confidence: 0.75 };

    expect(effectiveWeight(channel)).toBeCloseTo(0.65);
  });

  it('updates learned channel weights from selected candidate behavior', () => {
    const channels = defaultChannels();
    const selected = candidateWith({ halo: 0, drain: 500, score: 0.8 });
    const rejected = candidateWith({ halo: 0, drain: 3000, score: 0.4 });
    const next = learnChannelsFromPreference(channels, selected, rejected, { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 });

    expect(next.find((channel) => channel.id === 'drain-distance')!.learned).toBeGreaterThan(
      next.find((channel) => channel.id === 'same-category-cluster')!.learned,
    );
  });

  it('ranks candidates through enabled channel scores', () => {
    const channels = defaultChannels().map((channel) =>
      channel.id === 'drain-distance' ? { ...channel, prior: 1, learned: 1, confidence: 1 } : { ...channel, enabled: false },
    );
    const good = candidateWith({ halo: 0, drain: 300, score: 0.2 });
    const bad = candidateWith({ halo: 0, drain: 3000, score: 0.9 });

    expect(rankByChannels([bad, good], channels, { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 })[0]).toBe(good);
  });
});

describe('3D human and window model', () => {
  it('treats stacked boxes as non-colliding when their heights do not overlap', () => {
    expect(overlapVolume({ x: 0, y: 0, w: 500, h: 500, z: 0, h3: 800 }, { x: 0, y: 0, w: 500, h: 500, z: 900, h3: 400 })).toBe(0);
    expect(collides3D({ x: 0, y: 0, w: 500, h: 500, z: 0, h3: 1200 }, { x: 0, y: 0, w: 500, h: 500, z: 900, h3: 400 })).toBe(true);
  });

  it('creates a human usage box in front of a fixture', () => {
    const library = baseLib();
    const sink = placeRects(library.sink, 'N', 200, 1900, 2200);
    const placedSink: PlacedFixture = { ...sink, el: library.sink, wall: 'N', name: library.sink.name };

    const human = humanUsageBox(placedSink);

    expect(human).toMatchObject({ z: 0, h3: 1900 });
    expect(human!.y).toBeGreaterThan(placedSink.foot.y);
  });

  it('includes the new 3.0 channels in the test bench', () => {
    const ids = defaultChannels().map((channel) => channel.id);

    expect(ids).toContain('passing-while-used');
    expect(ids).toContain('daylight-access');
  });
});

describe('3.0 spatial integration (evaluator)', () => {
  const cfg = { W: 2400, D: 2400, wetWall: 'S' as const, minAisle: 600 };

  function place(el: ReturnType<typeof baseLib>[string], wall: 'N' | 'S' | 'E' | 'W', pos: number): PlacedFixture {
    const rects = placeRects(el, wall, pos, cfg.W, cfg.D);
    return { ...rects, el, wall, name: el.name };
  }
  function southDoor(pos: number): PlacedElement {
    const lib = baseLib();
    const rects = doorRects(lib.door, 'S', pos, 0, 'outward', cfg.W, cfg.D);
    return { ...rects, el: lib.door, name: lib.door.name };
  }

  it('does not flag a shelf stacked above a fixture (3D collision)', () => {
    const lib = baseLib();
    const cabinet = { ...lib.sink, name: 'Pult', w: 600, d: 500, z: 0, h: 850, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const shelf = { ...lib.sink, name: 'Polica', w: 600, d: 500, z: 1500, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const placed: PlacedElement[] = [southDoor(800), place(cabinet, 'N', 200), place(shelf, 'N', 200)];

    expect(evalPlace(placed, cfg, true).viol).not.toContain('prekrivanje opreme');
  });

  it('flags two fixtures overlapping at the same height', () => {
    const lib = baseLib();
    const cabinet = { ...lib.sink, name: 'Pult', w: 600, d: 500, z: 0, h: 850, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const shelf = { ...lib.sink, name: 'Polica', w: 600, d: 500, z: 0, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const placed: PlacedElement[] = [southDoor(800), place(cabinet, 'N', 200), place(shelf, 'N', 200)];

    expect(evalPlace(placed, cfg, true).viol).toContain('prekrivanje opreme');
  });

  it('flags a shelf that intrudes into the standing user volume (polica nad pisoarjem)', () => {
    const lib = baseLib();
    const shelf = { ...lib.urinal, name: 'Polica', w: 400, d: 800, z: 1500, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const placed: PlacedElement[] = [southDoor(800), place(lib.urinal, 'N', 800), place(shelf, 'N', 800)];

    expect(evalPlace(placed, cfg, true).viol.some((v) => v.startsWith('element v človeškem prostoru'))).toBe(true);
  });

  it('allows a ceiling installation above the human head (zračnik nad 1900)', () => {
    const lib = baseLib();
    const vent = { ...lib.urinal, name: 'Zračnik', w: 400, d: 800, z: 2000, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const placed: PlacedElement[] = [southDoor(800), place(lib.urinal, 'N', 800), place(vent, 'N', 800)];

    expect(evalPlace(placed, cfg, true).viol.some((v) => v.startsWith('element v človeškem prostoru'))).toBe(false);
  });

  it('flags a tall element that occludes a window, but allows a low one under the parapet', () => {
    const lib = baseLib();
    const tall = { ...lib.sink, name: 'Visoka omara', w: 600, d: 500, z: 0, h: 2000, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const low = { ...lib.sink, name: 'Nizka omarica', w: 600, d: 500, z: 0, h: 800, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const window = place(lib.window, 'S', 700);

    const tallViol = evalPlace([southDoor(1600), window, place(tall, 'S', 700)], cfg, true).viol;
    const lowViol = evalPlace([southDoor(1600), window, place(low, 'S', 700)], cfg, true).viol;

    expect(tallViol.some((v) => v.startsWith('element zastira okno'))).toBe(true);
    expect(lowViol.some((v) => v.startsWith('element zastira okno'))).toBe(false);
  });
});

describe('3.0 walkability (rang 1 prehodnost)', () => {
  it('finds a path through open space and through a gap in a wall', () => {
    const open = buildFreeGrid(3000, 3000, []);
    expect(reachable(open, { x: 200, y: 200 }, { x: 2800, y: 2800 })).toBe(true);

    const gapped = buildFreeGrid(3000, 3000, [
      { x: 0, y: 1400, w: 1000, h: 200, z: 0, h3: 2000 },
      { x: 1600, y: 1400, w: 1400, h: 200, z: 0, h3: 2000 },
    ]);
    expect(reachable(gapped, { x: 1500, y: 300 }, { x: 1500, y: 2700 })).toBe(true);
  });

  it('reports no path when a full-width wall splits the room', () => {
    const split = buildFreeGrid(3000, 3000, [{ x: 0, y: 1400, w: 3000, h: 200, z: 0, h3: 2000 }]);
    expect(reachable(split, { x: 1500, y: 300 }, { x: 1500, y: 2700 })).toBe(false);
  });

  it('ignores ceiling installations via the height filter (vent above 1900)', () => {
    const vent = buildFreeGrid(3000, 3000, [{ x: 0, y: 1400, w: 3000, h: 200, z: 2000, h3: 300 }]);
    expect(reachable(vent, { x: 1500, y: 300 }, { x: 1500, y: 2700 })).toBe(true);
  });

  it('measures a wider corridor in open space than through a narrow gap', () => {
    const open = buildFreeGrid(3000, 3000, []);
    const narrow = buildFreeGrid(3000, 3000, [
      { x: 0, y: 1400, w: 1300, h: 200, z: 0, h3: 2000 },
      { x: 1700, y: 1400, w: 1300, h: 200, z: 0, h3: 2000 },
    ]);
    const from = { x: 1500, y: 300 };
    const to = { x: 1500, y: 2700 };
    expect(corridorWidth(open, from, to)).toBeGreaterThan(corridorWidth(narrow, from, to));
  });
});

describe('4.0 active learning (Ugani kdo)', () => {
  const cfg = { W: 1900, D: 2200, wetWall: 'S' as const, minAisle: 800 };
  // en sam vklopljen, negotov kanal (drain-distance, nizko zaupanje); pri praznem
  // placed je njegova vrednost determinirana funkcija ev.drain.
  function singleUncertainChannel() {
    return defaultChannels().map((channel) =>
      channel.id === 'drain-distance'
        ? { ...channel, enabled: true, prior: 0.5, learned: 0.5, confidence: 0.1 }
        : { ...channel, enabled: false },
    );
  }

  it('returns null when there are fewer than two candidates', () => {
    expect(nextPair([candidateWith({ halo: 0, drain: 100, score: 0.5 })], defaultChannels(), cfg)).toBeNull();
  });

  it('explore=1 picks the pair that most splits uncertainty', () => {
    const channels = singleUncertainChannel();
    const near = candidateWith({ halo: 0, drain: 200, score: 0.9 });
    const mid = candidateWith({ halo: 0, drain: 1100, score: 0.6 });
    const far = candidateWith({ halo: 0, drain: 2100, score: 0.3 });

    const pair = nextPair([near, mid, far], channels, cfg, 1)!;
    const chosen = new Set([pair.a, pair.b]);

    expect(chosen.has(near)).toBe(true);
    expect(chosen.has(far)).toBe(true); // največja razlika po negotovem kanalu
  });

  it('explore=0 picks the two highest-quality candidates', () => {
    const channels = singleUncertainChannel();
    const near = candidateWith({ halo: 0, drain: 200, score: 0.9 });
    const mid = candidateWith({ halo: 0, drain: 1100, score: 0.6 });
    const far = candidateWith({ halo: 0, drain: 2100, score: 0.3 });

    const pair = nextPair([near, mid, far], channels, cfg, 0)!;
    const chosen = new Set([pair.a, pair.b]);

    expect(chosen.has(near)).toBe(true);
    expect(chosen.has(mid)).toBe(true); // najnižji odtok = najvišja kvaliteta
    expect(chosen.has(far)).toBe(false);
  });

  it('pair information grows with channel uncertainty', () => {
    const a = candidateWith({ halo: 0, drain: 200, score: 0.9 });
    const b = candidateWith({ halo: 0, drain: 2100, score: 0.3 });
    const certain = singleUncertainChannel().map((c) => ({ ...c, confidence: 0.95 }));
    const uncertain = singleUncertainChannel();

    expect(pairInformation(a, b, uncertain, cfg)).toBeGreaterThan(pairInformation(a, b, certain, cfg));
  });

  it('suggests more exploration early and less later', () => {
    expect(suggestedExplore(0)).toBeGreaterThan(suggestedExplore(10));
    expect(suggestedExplore(100)).toBe(0);
  });
});

describe('4.0 per-room constraints interface', () => {
  it('splits a RoomConstraints object into generator inputs', () => {
    const rc: RoomConstraints = {
      W: 1900,
      D: 2200,
      wetWall: 'S',
      extWall: 'N',
      minAisle: 800,
      doors: [{ id: 'd', key: 'door', w: 800 }],
      fixtures: [{ id: 't', key: 'toilet' }, { id: 's', key: 'sink' }],
      zones: [{ id: 'z', x: 100, y: 100, w: 300, h: 300 }],
      routingPolicy: { floorAllowed: false },
    };

    const split = fromRoomConstraints(rc);

    expect(split.cfg).toEqual({ W: 1900, D: 2200, wetWall: 'S', minAisle: 800 });
    expect(split.program.map((p) => p.key)).toEqual(['door', 'toilet', 'sink']);
    expect(split.zones).toHaveLength(1);
    expect(split.routingPolicy.floorAllowed).toBe(false);
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
