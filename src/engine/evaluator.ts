import type { Element, Wall } from '../elements/model';
import type { RoomConfig } from '../constraints/brief';
import type { NoGoZone } from '../constraints/zones';
import type { DoorRects, FixtureRects, Rect } from './geometry';
import { clamp } from '../shared/math';
import { distanceToWall, isInsideRoom, overlapArea, overlapBox } from './geometry';

export type PlacedFixture = FixtureRects & {
  el: Element;
  wall: Wall;
  name: string;
  kind?: undefined;
};

export type PlacedDoor = DoorRects & {
  el: Element;
  name: string;
};

export type PlacedElement = PlacedFixture | PlacedDoor;

export interface HaloOverlap {
  a: string;
  b: string;
  area: number;
  box: Rect | null;
}

export interface Evaluation {
  valid: boolean;
  viol: string[];
  halo: number;
  overlaps: HaloOverlap[];
  aisle: number;
  drain: number;
  score: number;
}

export function evalPlace(
  placed: PlacedElement[],
  cfg: RoomConfig,
  soft: boolean,
  zones: NoGoZone[] = [],
): Evaluation {
  const { W, D, wetWall, minAisle } = cfg;
  const violations: string[] = [];
  let halo = 0;
  const overlaps: HaloOverlap[] = [];
  const fixtures = placed.filter((item): item is PlacedFixture => item.kind !== 'door');
  const doors = placed.filter((item): item is PlacedDoor => item.kind === 'door');

  if (doors.length === 0) violations.push('soba nima vrat');

  for (const item of placed) {
    if (!isInsideRoom(item.foot, W, D)) violations.push('element izven sobe');
  }

  for (let i = 0; i < fixtures.length; i += 1) {
    for (let j = i + 1; j < fixtures.length; j += 1) {
      const a = fixtures[i];
      const b = fixtures[j];
      if (overlapArea(a.foot, b.foot) > 1) violations.push('prekrivanje opreme');
      if (overlapArea(a.hard, b.foot) > 1 || overlapArea(b.hard, a.foot) > 1) {
        violations.push('oprema v trdem jedru');
      }
      if (overlapArea(a.hard, b.hard) > 1) {
        violations.push(`trdi jedri se prekrivata (${a.name}<->${b.name})`);
      }

      const softOverlap = overlapArea(a.soft, b.soft);
      if (softOverlap > 1) {
        halo += softOverlap;
        overlaps.push({ a: a.name, b: b.name, area: softOverlap, box: overlapBox(a.soft, b.soft) });
        if (!soft) violations.push(`halo prekrivanje v strogem nacinu (${a.name}<->${b.name})`);
      }
    }
  }

  for (const door of doors) {
    for (const fixture of fixtures) {
      if (overlapArea(fixture.foot, door.foot) > 1) violations.push('oprema v odprtini vrat');
      if (door.swing && overlapArea(fixture.foot, door.swing) > 1) {
        violations.push(`vrata se odpirajo na opremo (${fixture.name})`);
      }
      if (overlapArea(fixture.foot, door.pass) > 1) violations.push('oprema v prehodu vrat');
    }
  }

  for (let i = 0; i < doors.length; i += 1) {
    for (let j = i + 1; j < doors.length; j += 1) {
      if (overlapArea(doors[i].foot, doors[j].foot) > 1) violations.push('vrata se prekrivajo');
    }
  }

  for (const zone of zones) {
    for (const item of placed) {
      if (overlapArea(item.foot, zone) > 1) violations.push('element v prepovedani coni');
      if (item.kind === 'door' && item.swing && overlapArea(item.swing, zone) > 1) {
        violations.push('lok vrat v prepovedani coni');
      }
    }
  }

  const ext: Record<Wall, number> = { N: 0, S: 0, E: 0, W: 0 };
  for (const fixture of fixtures) {
    const extent =
      fixture.wall === 'N' || fixture.wall === 'S'
        ? fixture.foot.h + fixture.el.clear.core
        : fixture.foot.w + fixture.el.clear.core;
    if (extent > ext[fixture.wall]) ext[fixture.wall] = extent;
  }

  const aisle = Math.min(W - ext.E - ext.W, D - ext.N - ext.S);
  if (aisle < minAisle) violations.push('prehod preozek');

  let drain = 0;
  for (const fixture of fixtures) {
    const center = { x: fixture.foot.x + fixture.foot.w / 2, y: fixture.foot.y + fixture.foot.h / 2 };
    drain += distanceToWall(center.x, center.y, wetWall, W, D);
  }

  const valid = violations.length === 0;
  const maxDim = Math.max(W, D);
  const haloN = clamp(halo / (maxDim * maxDim * 0.25), 0, 1);
  const drainN = clamp(fixtures.length ? drain / (fixtures.length * maxDim) : 0, 0, 1);
  const score = 1 - (haloN * 0.5 + drainN * 0.5);

  return {
    valid,
    viol: [...new Set(violations)],
    halo,
    overlaps,
    aisle,
    drain,
    score,
  };
}
