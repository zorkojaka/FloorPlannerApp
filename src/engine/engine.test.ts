import { describe, expect, it } from 'vitest';
import { baseLib } from '../elements/library';
import { orientation, serviceSides } from '../elements/model';
import type { PlacedElement } from './evaluator';
import { evalPlace } from './evaluator';
import { doorRects, overlapArea, placeRects } from './geometry';
import { generateLayoutPool } from './generator';

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
