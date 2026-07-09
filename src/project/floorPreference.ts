import type { FloorLayout, PlacedRoom } from './floorGenerator';
import { ROOM_TYPE_DEFINITIONS, zoneFromType, type ZoneId } from './roomTypes';

export interface FloorPreferenceWeights {
  compactness: number;
  corridorEfficiency: number;
  wetGrouping: number;
  officeFrontage: number;
  zoneContiguity: number;
  windowAccess: number;
}

export interface FloorPreferenceState {
  weights: FloorPreferenceWeights;
  comparisons: number;
  championId?: string;
}

export const DEFAULT_FLOOR_WEIGHTS: FloorPreferenceWeights = {
  compactness: 0.18,
  corridorEfficiency: 0.18,
  wetGrouping: 0.16,
  officeFrontage: 0.16,
  zoneContiguity: 0.16,
  windowAccess: 0.16,
};

export function initialFloorPreferenceState(): FloorPreferenceState {
  return { weights: { ...DEFAULT_FLOOR_WEIGHTS }, comparisons: 0 };
}

export function scoreFloorLayout(layout: FloorLayout, weights: FloorPreferenceWeights = DEFAULT_FLOOR_WEIGHTS): number {
  const roomArea = layout.rooms.reduce((sum, room) => sum + room.area, 0);
  const corridorArea = layout.corridor.area + (layout.corridorLinks || []).reduce((sum, link) => sum + link.area, 0);
  const usedArea = roomArea + corridorArea;
  const overflow = layout.warnings.length ? 0.45 : 1;
  const compactness = clamp01(usedArea / Math.max(layout.boundary.area, 1));
  const corridorEfficiency = clamp01(1 - corridorArea / Math.max(usedArea, 1));
  const wetGrouping = wetGroupingScore(layout);
  const officeFrontage = officeFrontageScore(layout);
  const zoneContiguity = zoneContiguityScore(layout);
  const windowAccess = windowAccessScore(layout);
  return overflow * (
    compactness * weights.compactness +
    corridorEfficiency * weights.corridorEfficiency +
    wetGrouping * weights.wetGrouping +
    officeFrontage * weights.officeFrontage +
    zoneContiguity * weights.zoneContiguity +
    windowAccess * weights.windowAccess
  );
}

export function rankFloorLayouts(layouts: FloorLayout[], weights: FloorPreferenceWeights = DEFAULT_FLOOR_WEIGHTS): FloorLayout[] {
  return [...layouts].sort((a, b) => scoreFloorLayout(b, weights) - scoreFloorLayout(a, weights));
}

export function recordFloorPreference(state: FloorPreferenceState, selected: FloorLayout, rejected: FloorLayout): FloorPreferenceState {
  const selectedSignals = floorSignals(selected);
  const rejectedSignals = floorSignals(rejected);
  const next = { ...state.weights };
  for (const key of Object.keys(next) as Array<keyof FloorPreferenceWeights>) {
    next[key] = Math.max(0.05, next[key] + (selectedSignals[key] - rejectedSignals[key]) * 0.08);
  }
  const total = Object.values(next).reduce((sum, value) => sum + value, 0) || 1;
  for (const key of Object.keys(next) as Array<keyof FloorPreferenceWeights>) next[key] /= total;
  return {
    weights: next,
    comparisons: state.comparisons + 1,
    championId: selected.id,
  };
}

export function floorSignals(layout: FloorLayout): FloorPreferenceWeights {
  const roomArea = layout.rooms.reduce((sum, room) => sum + room.area, 0);
  const corridorArea = layout.corridor.area + (layout.corridorLinks || []).reduce((sum, link) => sum + link.area, 0);
  const usedArea = roomArea + corridorArea;
  return {
    compactness: clamp01(usedArea / Math.max(layout.boundary.area, 1)),
    corridorEfficiency: clamp01(1 - corridorArea / Math.max(usedArea, 1)),
    wetGrouping: wetGroupingScore(layout),
    officeFrontage: officeFrontageScore(layout),
    zoneContiguity: zoneContiguityScore(layout),
    windowAccess: windowAccessScore(layout),
  };
}

/** Delež prostorov, ki potrebujejo okno (pisarne) in ga dejansko imajo (ob fasadi). */
function windowAccessScore(layout: FloorLayout): number {
  const needing = layout.rooms.filter((room) => ROOM_TYPE_DEFINITIONS[room.type]?.needsWindow);
  if (!needing.length) return 1;
  return needing.filter((room) => room.hasWindow).length / needing.length;
}

/**
 * A/B signal indukcije con: nagradi razporeditve, kjer sosednji prostori vzdolž
 * hodnika delijo isto cono (GMP ločevanje). Prostore razvrsti po strani hodnika in
 * vzdolžni osi ter meri delež sosednjih parov z enako cono.
 */
export function zoneContiguity(layout: FloorLayout): number {
  return zoneContiguityScore(layout);
}

function zoneContiguityScore(layout: FloorLayout): number {
  const rooms = layout.rooms.filter((room) => room.type !== 'corridor');
  if (rooms.length < 2) return 1;
  const horizontal = layout.corridor.w >= layout.corridor.d;
  // sobe grupiramo po vrstah (isti pas ob hodniku), znotraj vrste merimo sosednje pare
  const rows = new Map<string, PlacedRoom[]>();
  for (const room of rooms) {
    const key = horizontal ? `${round1(room.y)}_${round1(room.d)}` : `${round1(room.x)}_${round1(room.w)}`;
    rows.set(key, [...(rows.get(key) || []), room]);
  }
  let adjacent = 0;
  let same = 0;
  for (const row of rows.values()) {
    row.sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
    for (let i = 1; i < row.length; i++) {
      adjacent++;
      if (zoneOf(row[i - 1]) === zoneOf(row[i])) same++;
    }
  }
  return adjacent ? same / adjacent : 1;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function zoneOf(room: PlacedRoom): ZoneId {
  return room.zone ?? zoneFromType(room.type);
}

function wetGroupingScore(layout: FloorLayout): number {
  const wcRooms = layout.rooms.filter((room) => room.type === 'wc');
  if (!wcRooms.length) return 1;
  const maxX = Math.max(1, layout.boundary.width);
  return clamp01(1 - wcRooms.reduce((sum, room) => sum + room.x / maxX, 0) / wcRooms.length);
}

function officeFrontageScore(layout: FloorLayout): number {
  const offices = layout.rooms.filter((room) => room.type === 'office');
  if (!offices.length) return 1;
  const maxDepth = Math.max(1, layout.boundary.depth);
  return clamp01(offices.reduce((sum, room) => sum + room.d / maxDepth, 0) / offices.length);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
