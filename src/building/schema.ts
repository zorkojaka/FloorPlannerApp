/**
 * Referenčna shema načrta — "resnica", iz katere se inducirajo pravila.
 * Enote: mm. Koordinatni sistem: izhodišče zgoraj levo, y navzdol (SVG).
 *
 * Shema je od prvega dne večplastna (layers/zones/flows), čeprav jih WC/pisarne
 * PoC uporablja minimalno — prenos na proizvodne obrate ne sme zahtevati
 * spremembe sheme, samo več vsebine.
 */

export type RoomType = 'office' | 'wc' | 'corridor' | 'storage' | 'tech' | 'other';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WallSide = 'N' | 'S' | 'E' | 'W';

export interface PlanEntrance {
  side: WallSide;
  /** mm od levega (N/S) oz. zgornjega (E/W) roba stene */
  offset: number;
}

export interface PlanRoom {
  id: string;
  type: RoomType;
  name: string;
  rect: Rect;
  /** GMP-ready: cona čistosti / namembnostna cona (PoC je ne uporablja) */
  zone?: string;
}

/** Povezava vrat: kdo je s kom povezan; 'outside' označuje vhod. */
export interface PlanConnection {
  a: string;
  b: string | 'outside';
}

export interface PlanLayer {
  id: string;
  kind: 'architecture' | 'installations' | 'equipment' | 'zones' | 'flows';
  note?: string;
}

/** Tok kot zaporedje sob — pri proizvodnji material/ljudje/odpadki. */
export interface PlanFlow {
  id: string;
  kind: 'people' | 'material' | 'waste';
  path: string[];
}

export interface ReferencePlan {
  id: string;
  name: string;
  outline: Rect;
  entrances: PlanEntrance[];
  rooms: PlanRoom[];
  connections: PlanConnection[];
  layers: PlanLayer[];
  flows: PlanFlow[];
  source: 'synthetic' | 'ai-extracted' | 'user';
}

export function roomArea(room: PlanRoom): number {
  return room.rect.w * room.rect.h;
}

/** m² iz mm² */
export function toM2(areaMm2: number): number {
  return areaMm2 / 1_000_000;
}

export function entrancePoint(outline: Rect, entrance: PlanEntrance): { x: number; y: number } {
  switch (entrance.side) {
    case 'N':
      return { x: outline.x + entrance.offset, y: outline.y };
    case 'S':
      return { x: outline.x + entrance.offset, y: outline.y + outline.h };
    case 'W':
      return { x: outline.x, y: outline.y + entrance.offset };
    case 'E':
      return { x: outline.x + outline.w, y: outline.y + entrance.offset };
  }
}

export function rectsTouch(a: Rect, b: Rect, tolerance = 1): boolean {
  const sepX = a.x + a.w < b.x - tolerance || b.x + b.w < a.x - tolerance;
  const sepY = a.y + a.h < b.y - tolerance || b.y + b.h < a.y - tolerance;
  return !sepX && !sepY;
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 1): boolean {
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ox > tolerance && oy > tolerance;
}

export function rectCenter(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function validateReferencePlan(plan: unknown): ReferencePlan {
  if (!plan || typeof plan !== 'object') throw new Error('Načrt ni objekt.');
  const p = plan as Partial<ReferencePlan>;
  if (typeof p.id !== 'string' || !p.id) throw new Error('Načrt nima polja id.');
  if (typeof p.name !== 'string' || !p.name) throw new Error(`Načrt ${p.id} nima polja name.`);
  if (!isRect(p.outline)) throw new Error(`Načrt ${p.id} nima veljavnega outline.`);
  if (!Array.isArray(p.entrances) || p.entrances.length === 0)
    throw new Error(`Načrt ${p.id} nima vhodov (entrances).`);
  if (!Array.isArray(p.rooms) || p.rooms.length === 0)
    throw new Error(`Načrt ${p.id} nima sob (rooms).`);
  for (const room of p.rooms) {
    const r = room as Partial<PlanRoom>;
    if (typeof r.id !== 'string') throw new Error(`Načrt ${p.id}: soba brez id.`);
    if (typeof r.type !== 'string') throw new Error(`Načrt ${p.id}: soba ${r.id} brez tipa.`);
    if (!isRect(r.rect)) throw new Error(`Načrt ${p.id}: soba ${r.id} brez veljavnega rect.`);
  }
  if (!p.rooms.some((room) => room.type === 'corridor'))
    throw new Error(`Načrt ${p.id} nima hodnika (type: "corridor").`);
  return {
    id: p.id,
    name: p.name,
    outline: p.outline,
    entrances: p.entrances,
    rooms: p.rooms as PlanRoom[],
    connections: Array.isArray(p.connections) ? (p.connections as PlanConnection[]) : [],
    layers: Array.isArray(p.layers) ? (p.layers as PlanLayer[]) : [],
    flows: Array.isArray(p.flows) ? (p.flows as PlanFlow[]) : [],
    source: p.source === 'synthetic' || p.source === 'user' ? p.source : 'ai-extracted',
  };
}

function isRect(value: unknown): value is Rect {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Rect>;
  return (
    Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h)
  );
}
