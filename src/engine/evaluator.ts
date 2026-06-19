import type { Element, Wall } from '../elements/model';
import type { RoomConfig } from '../constraints/brief';
import type { NoGoZone } from '../constraints/zones';
import type { DoorRects, FixtureRects, Rect } from './geometry';
import type { Point } from './geometry';
import { clamp } from '../shared/math';
import { distanceToWall, isInsideRoom, overlapArea, overlapBox } from './geometry';
import { collides3D, elementBox, humanUsageBox, windowClearBox } from './volume';
import { buildFreeGrid, reachable } from './freespace';

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
      // §1: trk opreme je prostorski — kvadra se morata sekati po VSEH treh oseh.
      // Polica nad pultom (drug z-pas) zato ni trk; oprema na isti višini je.
      if (collides3D(elementBox(a), elementBox(b))) violations.push('prekrivanje opreme');
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

  // §2: ko se element uporablja, prikliče človeški kvader na svojo clearance cono.
  // Če ta kvader prebada drug element (npr. polica nad pisoarjem do 1900) → trk.
  // En princip namesto seznama prepovedi: spoštuj prostor, ki ga zasede človek.
  for (const user of fixtures) {
    const human = humanUsageBox(user);
    if (!human) continue;
    for (const other of fixtures) {
      if (other === user) continue;
      if (collides3D(human, elementBox(other))) {
        violations.push(`element v človeškem prostoru (${other.name} ob ${user.name})`);
      }
    }
  }

  // §4: pred oknom je prazni 3D volumen v njegovem višinskem pasu. Visok element,
  // ki sega v okenski pas, ga zastre → trk z okenskim volumnom.
  for (const win of fixtures) {
    const clearBox = windowClearBox(win);
    if (!clearBox) continue;
    for (const other of fixtures) {
      if (other === win) continue;
      if (collides3D(clearBox, elementBox(other))) {
        violations.push(`element zastira okno (${other.name})`);
      }
    }
  }

  // §3 rang 1: PREHODNOST (trdo). Do uporabne točke vsakega elementa mora
  // obstajati koridor od vrat skozi prosti prostor (tloris z višinskim filtrom).
  if (doors.length > 0 && fixtures.length > 0) {
    const obstacles = fixtures.map(elementBox);
    const grid = buildFreeGrid(W, D, obstacles);
    const entry = doorInteriorPoint(doors[0]);
    for (const fixture of fixtures) {
      const target = usagePoint(fixture);
      if (!reachable(grid, entry, target)) {
        violations.push(`ni prehodne poti do ${fixture.name}`);
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

// Vstopna točka skozi vrata: sredina prehodnega pasu, znotraj sobe.
export function doorInteriorPoint(door: PlacedDoor): Point {
  return { x: door.pass.x + door.pass.w / 2, y: door.pass.y + door.pass.h / 2 };
}

// Uporabna točka elementa: sredina človeškega kvadra (sprednji rob) če ima
// uporabnika, sicer sredina odtisa (okno, polica ipd.).
export function usagePoint(fixture: PlacedFixture): Point {
  const human = humanUsageBox(fixture);
  if (human) return { x: human.x + human.w / 2, y: human.y + human.h / 2 };
  return { x: fixture.foot.x + fixture.foot.w / 2, y: fixture.foot.y + fixture.foot.h / 2 };
}
