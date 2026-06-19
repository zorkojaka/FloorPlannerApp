import { describe, expect, it } from 'vitest';
import { baseLib } from '../elements/library';
import type { PlacedElement, PlacedFixture } from './evaluator';
import { doorRects, placeRects } from './geometry';
import { buildElevation } from './elevation';

describe('side elevation projection', () => {
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

  it('projects wall fixtures into along-wall by height rectangles', () => {
    const lib = baseLib();
    const model = buildElevation([southDoor(800), place(lib.urinal, 'N', 800)], cfg, 'N');
    const urinal = model.rects.find((rect) => rect.kind === 'element' && rect.name === 'Pisoar');
    const human = model.rects.find((rect) => rect.kind === 'human');

    expect(model.width).toBe(cfg.W);
    expect(urinal).toMatchObject({ x: 800, y: 0, w: 400, h: 1100 });
    expect(human).toMatchObject({ y: 0, h: 1900 });
  });

  it('marks a shelf that intrudes into the standing human volume', () => {
    const lib = baseLib();
    const shelf = { ...lib.urinal, name: 'Polica', w: 400, d: 800, z: 1500, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const model = buildElevation([southDoor(800), place(lib.urinal, 'N', 800), place(shelf, 'N', 800)], cfg, 'N');

    expect(model.conflicts).toHaveLength(1);
    expect(model.conflicts[0]).toMatchObject({ x: 800, y: 1500, w: 400, h: 300, elementName: 'Polica' });
  });

  it('does not mark a ceiling vent above the standing human volume', () => {
    const lib = baseLib();
    const vent = { ...lib.urinal, name: 'Zračnik', w: 400, d: 800, z: 2000, h: 300, conns: [], usage: { posture: 'none' as const, userAt: 'front' as const } };
    const model = buildElevation([southDoor(800), place(lib.urinal, 'N', 800), place(vent, 'N', 800)], cfg, 'N');

    expect(model.conflicts).toHaveLength(0);
  });

  it('shows a window with parapet and height on the selected wall', () => {
    const lib = baseLib();
    const model = buildElevation([southDoor(1600), place(lib.window, 'S', 700)], cfg, 'S');
    const window = model.rects.find((rect) => rect.kind === 'window');

    expect(window).toMatchObject({ x: 700, y: 900, w: 900, h: 1100 });
  });
});
