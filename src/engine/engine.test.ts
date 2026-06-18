import { describe, expect, it } from 'vitest';
import { baseLib } from '../elements/library';
import { orientation, serviceSides } from '../elements/model';
import type { PlacedElement, PlacedFixture } from './evaluator';
import { evalPlace } from './evaluator';
import { checkFeasibility } from './feasibility';
import { doorRects, overlapArea, placeRects } from './geometry';
import { generateLayoutPool } from './generator';
import { placedConnectionPoint, routeServices } from './routing';

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
