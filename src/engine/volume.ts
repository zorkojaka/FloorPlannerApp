import type { PlacedFixture } from './evaluator';
import type { Rect } from './geometry';

export interface Box3D extends Rect {
  z: number;
  h3: number;
}

export interface HumanVolume {
  posture: 'standing' | 'seated';
  w: number;
  d: number;
  h: number;
}

export const HUMAN_VOLUMES: Record<HumanVolume['posture'], HumanVolume> = {
  standing: { posture: 'standing', w: 600, d: 400, h: 1900 },
  seated: { posture: 'seated', w: 600, d: 900, h: 1400 },
};

export function elementBox(fixture: PlacedFixture): Box3D {
  return {
    ...fixture.foot,
    z: fixture.el.z ?? 0,
    h3: fixture.el.h ?? 0,
  };
}

export function humanUsageBox(fixture: PlacedFixture): Box3D | null {
  const posture = fixture.el.usage?.posture;
  if (!posture || posture === 'none') return null;
  const human = HUMAN_VOLUMES[posture];
  const zone = usageRect(fixture, human);
  return { ...zone, z: 0, h3: human.h };
}

export function windowClearBox(fixture: PlacedFixture): Box3D | null {
  if (fixture.el.kind !== 'window') return null;
  const depth = 700;
  const z = fixture.el.parapet ?? fixture.el.z ?? 900;
  const h3 = fixture.el.h ?? 1100;
  if (fixture.wall === 'N') return { x: fixture.foot.x, y: fixture.foot.y + fixture.foot.h, w: fixture.foot.w, h: depth, z, h3 };
  if (fixture.wall === 'S') return { x: fixture.foot.x, y: fixture.foot.y - depth, w: fixture.foot.w, h: depth, z, h3 };
  if (fixture.wall === 'W') return { x: fixture.foot.x + fixture.foot.w, y: fixture.foot.y, w: depth, h: fixture.foot.h, z, h3 };
  return { x: fixture.foot.x - depth, y: fixture.foot.y, w: depth, h: fixture.foot.h, z, h3 };
}

export function overlapVolume(a: Box3D, b: Box3D): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const z = Math.max(0, Math.min(a.z + a.h3, b.z + b.h3) - Math.max(a.z, b.z));
  return x * y * z;
}

export function collides3D(a: Box3D, b: Box3D): boolean {
  return overlapVolume(a, b) > 1;
}

export function usageRect(fixture: PlacedFixture, human: HumanVolume): Rect {
  const foot = fixture.foot;
  if (fixture.wall === 'N') return { x: foot.x + foot.w / 2 - human.w / 2, y: foot.y + foot.h, w: human.w, h: human.d };
  if (fixture.wall === 'S') return { x: foot.x + foot.w / 2 - human.w / 2, y: foot.y - human.d, w: human.w, h: human.d };
  if (fixture.wall === 'W') return { x: foot.x + foot.w, y: foot.y + foot.h / 2 - human.w / 2, w: human.d, h: human.w };
  return { x: foot.x - human.d, y: foot.y + foot.h / 2 - human.w / 2, w: human.d, h: human.w };
}

export function humanCollisionCount(fixtures: PlacedFixture[]): number {
  const humans = fixtures.map(humanUsageBox).filter((box): box is Box3D => Boolean(box));
  const elements = fixtures.map(elementBox);
  let collisions = 0;
  for (const human of humans) {
    for (const element of elements) {
      if (collides3D(human, element)) collisions += 1;
    }
  }
  return collisions;
}
