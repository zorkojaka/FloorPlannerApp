import type { Wall } from '../elements/model';
import type { RoomConfig } from '../constraints/brief';
import type { PlacedElement, PlacedFixture } from './evaluator';
import type { Rect } from './geometry';
import type { Box3D } from './volume';
import { collides3D, elementBox, humanUsageBox } from './volume';

export interface ElevationRect extends Rect {
  id: string;
  name: string;
  kind: 'element' | 'human' | 'window';
  source: PlacedFixture;
}

export interface ElevationConflict extends Rect {
  elementName: string;
  humanName: string;
}

export interface ElevationModel {
  wall: Wall;
  width: number;
  height: number;
  rects: ElevationRect[];
  conflicts: ElevationConflict[];
}

export function buildElevation(placed: PlacedElement[], cfg: RoomConfig, wall: Wall, maxHeight = 2600): ElevationModel {
  const fixtures = placed.filter((item): item is PlacedFixture => item.kind !== 'door');
  const onWall = fixtures.filter((fixture) => fixture.wall === wall);
  const rects: ElevationRect[] = [];

  for (const fixture of onWall) {
    const box = elementBox(fixture);
    rects.push({
      ...projectBox(box, wall),
      id: `element-${fixture.name}-${rects.length}`,
      name: fixture.name,
      kind: fixture.el.kind === 'window' ? 'window' : 'element',
      source: fixture,
    });

    const human = humanUsageBox(fixture);
    if (human) {
      rects.push({
        ...projectBox(human, wall),
        id: `human-${fixture.name}-${rects.length}`,
        name: `${fixture.name}: človek`,
        kind: 'human',
        source: fixture,
      });
    }
  }

  const humans = onWall
    .map((fixture) => ({ fixture, box: humanUsageBox(fixture) }))
    .filter((item): item is { fixture: PlacedFixture; box: Box3D } => Boolean(item.box));

  const conflicts: ElevationConflict[] = [];
  for (const human of humans) {
    for (const element of fixtures) {
      if (element === human.fixture) continue;
      const elementVolume = elementBox(element);
      if (!collides3D(human.box, elementVolume)) continue;
      const overlap = overlapProjected(projectBox(human.box, wall), projectBox(elementVolume, wall));
      if (!overlap) continue;
      conflicts.push({ ...overlap, elementName: element.name, humanName: human.fixture.name });
    }
  }

  return {
    wall,
    width: wall === 'N' || wall === 'S' ? cfg.W : cfg.D,
    height: maxHeight,
    rects,
    conflicts,
  };
}

function projectBox(box: Box3D, wall: Wall): Rect {
  if (wall === 'N' || wall === 'S') return { x: box.x, y: box.z, w: box.w, h: box.h3 };
  return { x: box.y, y: box.z, w: box.h, h: box.h3 };
}

function overlapProjected(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}
