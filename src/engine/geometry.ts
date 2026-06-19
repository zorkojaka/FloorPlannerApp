import type { Connection, Element, Wall } from '../elements/model';
import { clamp } from '../shared/math';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface FixtureRects {
  foot: Rect;
  hard: Rect;
  soft: Rect;
}

export interface DoorRects {
  foot: Rect;
  swing: Rect | null;
  pass: Rect;
  wall: Wall;
  hinge: 0 | 1;
  dir: 'inward' | 'outward';
  kind: 'door';
}

export function connectionPoint(connection: Connection, rect: Rect): Point {
  if (connection.side === 'back') return { x: rect.x + connection.off * rect.w, y: rect.y };
  if (connection.side === 'front') return { x: rect.x + connection.off * rect.w, y: rect.y + rect.h };
  if (connection.side === 'left') return { x: rect.x, y: rect.y + connection.off * rect.h };
  return { x: rect.x + rect.w, y: rect.y + connection.off * rect.h };
}

export function nearestEdge(px: number, py: number, rect: Rect): { side: Connection['side']; off: number } {
  const dTop = Math.abs(py - rect.y);
  const dBottom = Math.abs(py - (rect.y + rect.h));
  const dLeft = Math.abs(px - rect.x);
  const dRight = Math.abs(px - (rect.x + rect.w));
  const minDistance = Math.min(dTop, dBottom, dLeft, dRight);

  if (minDistance === dTop) return { side: 'back', off: clamp((px - rect.x) / rect.w, 0, 1) };
  if (minDistance === dBottom) return { side: 'front', off: clamp((px - rect.x) / rect.w, 0, 1) };
  if (minDistance === dLeft) return { side: 'left', off: clamp((py - rect.y) / rect.h, 0, 1) };
  return { side: 'right', off: clamp((py - rect.y) / rect.h, 0, 1) };
}

export function placeRects(element: Element, wall: Wall, pos: number, roomW: number, roomD: number): FixtureRects {
  const along = element.w;
  const depth = element.d;
  const core = element.clear.core;
  const halo = element.clear.halo;

  if (wall === 'S') {
    return {
      foot: { x: pos, y: roomD - depth, w: along, h: depth },
      hard: { x: pos, y: roomD - depth - core, w: along, h: core },
      soft: { x: pos, y: roomD - depth - halo, w: along, h: halo },
    };
  }

  if (wall === 'N') {
    return {
      foot: { x: pos, y: 0, w: along, h: depth },
      hard: { x: pos, y: depth, w: along, h: core },
      soft: { x: pos, y: depth, w: along, h: halo },
    };
  }

  if (wall === 'W') {
    return {
      foot: { x: 0, y: pos, w: depth, h: along },
      hard: { x: depth, y: pos, w: core, h: along },
      soft: { x: depth, y: pos, w: halo, h: along },
    };
  }

  return {
    foot: { x: roomW - depth, y: pos, w: depth, h: along },
    hard: { x: roomW - depth - core, y: pos, w: core, h: along },
    soft: { x: roomW - depth - halo, y: pos, w: halo, h: along },
  };
}

export function doorRects(
  element: Element,
  wall: Wall,
  pos: number,
  hinge: 0 | 1,
  dir: 'inward' | 'outward',
  roomW: number,
  roomD: number,
): DoorRects {
  const leafWidth = element.w;
  const threshold = 80;
  const passDepth = 520;

  if (wall === 'S') {
    const swing = { x: pos, y: roomD - leafWidth, w: leafWidth, h: leafWidth };
    return {
      foot: { x: pos, y: roomD - threshold, w: leafWidth, h: threshold },
      swing: dir === 'inward' ? swing : null,
      pass: { x: pos, y: roomD - passDepth, w: leafWidth, h: passDepth },
      wall,
      hinge,
      dir,
      kind: 'door',
    };
  }

  if (wall === 'N') {
    const swing = { x: pos, y: 0, w: leafWidth, h: leafWidth };
    return {
      foot: { x: pos, y: 0, w: leafWidth, h: threshold },
      swing: dir === 'inward' ? swing : null,
      pass: { x: pos, y: 0, w: leafWidth, h: passDepth },
      wall,
      hinge,
      dir,
      kind: 'door',
    };
  }

  if (wall === 'W') {
    const swing = { x: 0, y: pos, w: leafWidth, h: leafWidth };
    return {
      foot: { x: 0, y: pos, w: threshold, h: leafWidth },
      swing: dir === 'inward' ? swing : null,
      pass: { x: 0, y: pos, w: passDepth, h: leafWidth },
      wall,
      hinge,
      dir,
      kind: 'door',
    };
  }

  const swing = { x: roomW - leafWidth, y: pos, w: leafWidth, h: leafWidth };
  return {
    foot: { x: roomW - threshold, y: pos, w: threshold, h: leafWidth },
    swing: dir === 'inward' ? swing : null,
    pass: { x: roomW - passDepth, y: pos, w: passDepth, h: leafWidth },
    wall,
    hinge,
    dir,
    kind: 'door',
  };
}

// Ali daljica (a→b) seka pravokotnik (npr. trasa odvoda čez odprtino vrat).
export function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  const inside = (p: Point) => p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
  if (inside(a) || inside(b)) return true;
  const r = { x1: rect.x, y1: rect.y, x2: rect.x + rect.w, y2: rect.y + rect.h };
  const edges: [Point, Point][] = [
    [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }],
    [{ x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }],
    [{ x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 }],
    [{ x: r.x1, y: r.y2 }, { x: r.x1, y: r.y1 }],
  ];
  return edges.some(([c, d]) => segmentsCross(a, b, c, d));
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}

export function overlapArea(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

export function overlapBox(a: Rect, b: Rect): Rect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

export function isInsideRoom(rect: Rect, roomW: number, roomD: number, epsilon = 2): boolean {
  return rect.x >= -epsilon && rect.y >= -epsilon && rect.x + rect.w <= roomW + epsilon && rect.y + rect.h <= roomD + epsilon;
}

export function distanceToWall(cx: number, cy: number, wall: Wall, roomW: number, roomD: number): number {
  if (wall === 'S') return roomD - cy;
  if (wall === 'N') return cy;
  if (wall === 'E') return roomW - cx;
  return cx;
}

export interface DoorSwingGeometry {
  hx: number; hy: number; // tečaj (fiksna točka na zidu)
  jx: number; jy: number; // zaprti podboj (krilo zaprto leži tu)
  tx: number; ty: number; // konica odprtega krila (90°, pravokotno na zid)
  lw: number; // širina krila = radij loka
  sweep: 0 | 1; // SVG smer loka, izračunana iz dejanskega kota (atan2)
}

/**
 * Geometrija nihanja vrat: tečaj je fiksna točka na zidu; krilo gre iz tečaja
 * pravokotno v sobo (Noter) ali ven (Ven); lok pomete z radijem = širina krila
 * okoli tečaja do zaprtega podboja. Smer loka (sweep) iz atan2, ne fiksne logike.
 */
export function doorSwing(
  wall: Wall,
  hinge: 0 | 1,
  dir: 'inward' | 'outward',
  foot: Rect,
  roomW: number,
  roomD: number,
): DoorSwingGeometry {
  const lw = wall === 'N' || wall === 'S' ? foot.w : foot.h;
  const norm: Record<Wall, [number, number]> = { S: [0, -1], N: [0, 1], W: [1, 0], E: [-1, 0] };
  const along: Record<Wall, [number, number]> = { S: [1, 0], N: [1, 0], W: [0, 1], E: [0, 1] };
  let sx: number, sy: number;
  if (wall === 'S') { sx = foot.x; sy = roomD; }
  else if (wall === 'N') { sx = foot.x; sy = 0; }
  else if (wall === 'W') { sx = 0; sy = foot.y; }
  else { sx = roomW; sy = foot.y; }

  const sgn = dir === 'outward' ? -1 : 1;
  const hs = hinge ? 1 : 0;
  const hx = sx + along[wall][0] * lw * hs, hy = sy + along[wall][1] * lw * hs;
  const jx = sx + along[wall][0] * lw * (1 - hs), jy = sy + along[wall][1] * lw * (1 - hs);
  const tx = hx + norm[wall][0] * lw * sgn, ty = hy + norm[wall][1] * lw * sgn;

  const aT = Math.atan2(ty - hy, tx - hx);
  const aJ = Math.atan2(jy - hy, jx - hx);
  let d = aJ - aT;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;

  return { hx, hy, jx, jy, tx, ty, lw, sweep: d > 0 ? 1 : 0 };
}

export function wallEdge(wall: Wall, roomW: number, roomD: number): { x1: number; y1: number; x2: number; y2: number } {
  if (wall === 'S') return { x1: 0, y1: roomD, x2: roomW, y2: roomD };
  if (wall === 'N') return { x1: 0, y1: 0, x2: roomW, y2: 0 };
  if (wall === 'W') return { x1: 0, y1: 0, x2: 0, y2: roomD };
  return { x1: roomW, y1: 0, x2: roomW, y2: roomD };
}
