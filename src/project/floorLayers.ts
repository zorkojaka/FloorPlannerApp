/**
 * Večplastna shema na project hrbtenici (korak k GMP-ready modelu): poleg
 * prostorov nosi še CONE (namembnost/čistost) in TOKOVE (ljudje/material/odpadki).
 * Za generirano etažo cone izpeljemo iz tipa prostora, tok ljudi pa iz hodniške
 * hrbtenice (vhod → hodnik → prostori). Realni uvoz (IFC/AI) lahko prinese cone
 * kot resnico (NormalizedIfcRoom.zone) — model je isti.
 */

import type { FloorLayout, PlacedRoom } from './floorGenerator';

export type ZoneId = 'work' | 'sanitary' | 'circulation' | 'service' | 'technical' | 'other';

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
  if (room.zone && ZONE_DEFS.some((def) => def.id === room.zone)) return room.zone as ZoneId;
  if (room.type === 'corridor') return 'circulation';
  if (room.type === 'wc') return 'sanitary';
  if (room.type === 'office') return 'work';
  return 'other';
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

/** Izpelji cone in tok ljudi iz generirane etaže. */
export function deriveFloorLayers(layout: FloorLayout): FloorLayers {
  const allRooms = [...layout.rooms, layout.corridor, ...(layout.corridorLinks || [])].filter(Boolean);
  const zoneByRoom: Record<string, ZoneId> = {};
  for (const room of allRooms) zoneByRoom[room.id] = roomZone(room);

  const c = layout.corridor;
  const horizontal = c.w >= c.d;
  const W = layout.boundary.width;
  const D = layout.boundary.depth;
  const cCenter = horizontal ? c.y + c.d / 2 : c.x + c.w / 2;
  const entry = entrancePoint(layout);

  const spine = horizontal
    ? [{ x: 0, y: cCenter }, { x: W, y: cCenter }]
    : [{ x: cCenter, y: 0 }, { x: cCenter, y: D }];
  const entrySpur = horizontal
    ? [{ x: entry.x, y: entry.y }, { x: entry.x, y: cCenter }]
    : [{ x: entry.x, y: entry.y }, { x: cCenter, y: entry.y }];

  const spurs = layout.rooms
    .filter((room) => room.type !== 'corridor')
    .map((room) => {
      const rx = room.x + room.w / 2;
      const ry = room.y + room.d / 2;
      const drop = horizontal ? { x: rx, y: cCenter } : { x: cCenter, y: ry };
      return [{ x: rx, y: ry }, drop];
    });

  return {
    zoneByRoom,
    flows: [
      {
        kind: 'people',
        label: 'Ljudje',
        color: '#2f7d3f',
        polylines: [spine, entrySpur, ...spurs],
      },
    ],
  };
}
