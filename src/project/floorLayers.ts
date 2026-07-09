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

/** Izpelji cone in tokove (ljudje/material/odpadki) iz generirane etaže. */
export function deriveFloorLayers(layout: FloorLayout): FloorLayers {
  const allRooms = [...layout.rooms, layout.corridor, ...(layout.corridorLinks || [])].filter(Boolean);
  const zoneByRoom: Record<string, ZoneId> = {};
  for (const room of allRooms) zoneByRoom[room.id] = roomZone(room);

  const c = layout.corridor;
  const horizontal = c.w >= c.d;
  const W = layout.boundary.width;
  const D = layout.boundary.depth;
  const cCenter = horizontal ? c.y + c.d / 2 : c.x + c.w / 2;
  const half = (horizontal ? c.d : c.w) / 2;
  const off = Math.max(0.12, Math.min(0.45, half * 0.5)); // razmik vzporednih sledi v hodniku
  const entry = entrancePoint(layout);
  const along = horizontal ? W : D;
  const entryAlong = horizontal ? entry.x : entry.y;
  const farAlong = entryAlong < along / 2 ? along : 0; // nasprotni konec hodnika (izhod odpadkov)

  // GMP ločevanje: vsak tok teče po svoji vzporedni sledi znotraj hodnika
  const peopleFlow = buildFlow('people', 'Ljudje', '#2f7d3f', layout, zoneByRoom, {
    horizontal, cLine: cCenter, entry, entryAlong, roomFilter: () => true,
  });
  const materialFlow = buildFlow('material', 'Material', '#2f6ea8', layout, zoneByRoom, {
    horizontal, cLine: cCenter + off, entry, entryAlong, roomFilter: (zone) => MATERIAL_ZONES.includes(zone),
  });
  const wasteFlow = buildFlow('waste', 'Odpadki', '#b5651d', layout, zoneByRoom, {
    horizontal, cLine: cCenter - off, entry: null, entryAlong: farAlong, roomFilter: (zone) => WASTE_ZONES.includes(zone),
    exitAlong: farAlong,
  });

  return { zoneByRoom, flows: [peopleFlow, materialFlow, wasteFlow].filter((flow) => flow.polylines.length > 1) };
}

interface FlowBuildOpts {
  horizontal: boolean;
  /** cross-osna koordinata sledi (centerline ± razmik) */
  cLine: number;
  /** vstopna točka toka (npr. glavni vhod); null → brez vstopnega kraka */
  entry: { x: number; y: number } | null;
  /** vzdolžna koordinata vstopa/izvora */
  entryAlong: number;
  /** vzdolžna koordinata izhoda (npr. odpadki na nasprotnem koncu) */
  exitAlong?: number;
  roomFilter: (zone: ZoneId) => boolean;
}

function buildFlow(
  kind: FloorFlow['kind'],
  label: string,
  color: string,
  layout: FloorLayout,
  zoneByRoom: Record<string, ZoneId>,
  opts: FlowBuildOpts,
): FloorFlow {
  const { horizontal, cLine } = opts;
  const W = layout.boundary.width;
  const D = layout.boundary.depth;
  const at = (alongCoord: number, crossCoord: number) => (horizontal ? { x: alongCoord, y: crossCoord } : { x: crossCoord, y: alongCoord });

  const spine = horizontal ? [{ x: 0, y: cLine }, { x: W, y: cLine }] : [{ x: cLine, y: 0 }, { x: cLine, y: D }];
  const polylines: Array<Array<{ x: number; y: number }>> = [spine];

  if (opts.entry) {
    polylines.push([{ x: opts.entry.x, y: opts.entry.y }, at(opts.entryAlong, cLine)]);
  }
  if (opts.exitAlong !== undefined) {
    // kratek pahljač do roba etaže na nasprotnem koncu (izhod odpadkov)
    const edge = horizontal ? { x: opts.exitAlong, y: D } : { x: W, y: opts.exitAlong };
    polylines.push([at(opts.exitAlong, cLine), edge]);
  }

  for (const room of layout.rooms) {
    if (room.type === 'corridor') continue;
    if (!opts.roomFilter(zoneByRoom[room.id] || 'other')) continue;
    const rx = room.x + room.w / 2;
    const ry = room.y + room.d / 2;
    const drop = horizontal ? { x: rx, y: cLine } : { x: cLine, y: ry };
    polylines.push([{ x: rx, y: ry }, drop]);
  }

  return { kind, label, color, polylines };
}
