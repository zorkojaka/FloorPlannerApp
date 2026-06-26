import type { FloorLayout } from './floorGenerator';

export interface FloorPreferenceWeights {
  compactness: number;
  corridorEfficiency: number;
  wetGrouping: number;
  officeFrontage: number;
}

export interface FloorPreferenceState {
  weights: FloorPreferenceWeights;
  comparisons: number;
  championId?: string;
}

export const DEFAULT_FLOOR_WEIGHTS: FloorPreferenceWeights = {
  compactness: 0.25,
  corridorEfficiency: 0.25,
  wetGrouping: 0.25,
  officeFrontage: 0.25,
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
  return overflow * (
    compactness * weights.compactness +
    corridorEfficiency * weights.corridorEfficiency +
    wetGrouping * weights.wetGrouping +
    officeFrontage * weights.officeFrontage
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
  };
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
