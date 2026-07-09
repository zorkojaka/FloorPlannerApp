/**
 * Večplastna shema na project hrbtenici (korak k GMP-ready modelu): poleg
 * prostorov nosi še CONE (namembnost/čistost) in TOKOVE (ljudje/material/odpadki).
 * Za generirano etažo cone izpeljemo iz tipa prostora, tok ljudi pa iz hodniške
 * hrbtenice (vhod → hodnik → prostori). Realni uvoz (IFC/AI) lahko prinese cone
 * kot resnico (NormalizedIfcRoom.zone) — model je isti.
 */

import type { FloorLayout, PlacedRoom } from './floorGenerator';
import { zoneFromType, type ZoneId } from './roomTypes';

export type { ZoneId };

export interface ZoneDef {
  id: ZoneId;
  label: string;
  fill: string;
}

export const ZONE_DEFS: ZoneDef[] = [
  { id: 'work', label: 'Delo', fill: '#8fb8e0' },
  { id: 'sanitary', label: 'Sanitarije', fill: '#6fd0d0' },
  { id: 'circulation', label: 'Komunikacije', fill: '#d9c27a' },
  { id: 'service', label: 'Servis', fill: '#c9a58a' },
  { id: 'technical', label: 'Tehnika', fill: '#b79ad0' },
  { id: 'other', label: 'Ostalo', fill: '#c2c8cf' },
];

export function zoneFill(zone: ZoneId): string {
  return (ZONE_DEFS.find((def) => def.id === zone) || ZONE_DEFS[ZONE_DEFS.length - 1]).fill;
}

export function zoneLabel(zone: ZoneId): string {
  return (ZONE_DEFS.find((def) => def.id === zone) || ZONE_DEFS[ZONE_DEFS.length - 1]).label;
}

/** Cona prostora — spoštuje eksplicitno oznako, sicer izpelje iz tipa. */
export function roomZone(room: PlacedRoom & { zone?: string }): ZoneId {
  return zoneFromType(room.type, room.zone);
}

export interface FloorFlow {
  kind: 'people' | 'material' | 'waste';
  label: string;
  color: string;
  /** poti v metrih (svetovne koordinate etaže) */
  polylines: Array<Array<{ x: number; y: number }>>;
}

export interface FloorLayers {
  zoneByRoom: Record<string, ZoneId>;
  flows: FloorFlow[];
}

function entrancePoint(layout: FloorLayout): { x: number; y: number } {
  const W = layout.boundary.width;
  const D = layout.boundary.depth;
  const e = (layout.entrances || [])[0];
  if (!e) return { x: W / 2, y: D };
  const pos = Math.min(Math.max(e.position ?? 0.5, 0), 1);
  if (e.wall === 'N') return { x: pos * W, y: 0 };
  if (e.wall === 'S') return { x: pos * W, y: D };
  if (e.wall === 'W') return { x: 0, y: pos * D };
  return { x: W, y: pos * D };
}

/** Zone, ki generirajo/sprejemajo posamezen tok. */
const MATERIAL_ZONES: ZoneId[] = ['work', 'technical'];
const WASTE_ZONES: ZoneId[] = ['work', 'technical', 'sanitary'];

type Pt = { x: number; y: number };

/** Projekcija središča sobe na najbližji hodnik (točka na osi hodnika). */
function dropToNearestCorridor(center: Pt, corridors: PlacedRoom[]): Pt {
  let best: Pt = center;
  let bestDist = Infinity;
  for (const c of corridors) {
    const horiz = c.w >= c.d;
    const axis = horiz ? c.y + c.d / 2 : c.x + c.w / 2;
    const proj: Pt = horiz
      ? { x: Math.min(Math.max(center.x, c.x), c.x + c.w), y: axis }
      : { x: axis, y: Math.min(Math.max(center.y, c.y), c.y + c.d) };
    const dist = Math.hypot(center.x - proj.x, center.y - proj.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = proj;
    }
  }
  return best;
}

/** Izpelji cone in tokove (ljudje/material/odpadki) iz generirane etaže. */
export function deriveFloorLayers(layout: FloorLayout): FloorLayers {
  const corridors = [layout.corridor, ...(layout.corridorLinks || [])].filter(Boolean);
  const allRooms = [...layout.rooms, ...corridors];
  const zoneByRoom: Record<string, ZoneId> = {};
  for (const room of allRooms) zoneByRoom[room.id] = roomZone(room);

  const D = layout.boundary.depth;
  const entry = entrancePoint(layout);
  // hrbtenica = osi vseh hodnikov (veje + konektor)
  const spines: Pt[][] = corridors.map((c) => {
    const horiz = c.w >= c.d;
    return horiz
      ? [{ x: c.x, y: c.y + c.d / 2 }, { x: c.x + c.w, y: c.y + c.d / 2 }]
      : [{ x: c.x + c.w / 2, y: c.y }, { x: c.x + c.w / 2, y: c.y + c.d }];
  });

  const rooms = layout.rooms.filter((room) => room.type !== 'corridor');
  const dropsFor = (filter: (zone: ZoneId) => boolean): Pt[][] =>
    rooms
      .filter((room) => filter(zoneByRoom[room.id] || 'other'))
      .map((room) => {
        const center: Pt = { x: room.x + room.w / 2, y: room.y + room.d / 2 };
        return [center, dropToNearestCorridor(center, corridors)];
      });

  // izhod odpadkov: kot od vhoda najbolj oddaljeni rob etaže
  const wasteExit: Pt = entry.y <= D / 2 ? { x: entry.x, y: D } : { x: entry.x, y: 0 };
  const entrySpine = dropToNearestCorridor(entry, corridors);

  const peopleFlow: FloorFlow = {
    kind: 'people', label: 'Ljudje', color: '#2f7d3f',
    polylines: [...spines, [entry, entrySpine], ...dropsFor(() => true)],
  };
  const materialFlow: FloorFlow = {
    kind: 'material', label: 'Material', color: '#2f6ea8',
    polylines: [[entry, entrySpine], ...dropsFor((zone) => MATERIAL_ZONES.includes(zone))],
  };
  const wasteFlow: FloorFlow = {
    kind: 'waste', label: 'Odpadki', color: '#b5651d',
    polylines: [...dropsFor((zone) => WASTE_ZONES.includes(zone)), [dropToNearestCorridor(wasteExit, corridors), wasteExit]],
  };

  return { zoneByRoom, flows: [peopleFlow, materialFlow, wasteFlow].filter((flow) => flow.polylines.length > 0) };
}
