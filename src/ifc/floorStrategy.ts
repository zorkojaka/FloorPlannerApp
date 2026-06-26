import type { FloorLayout } from '../project/floorGenerator';
import { rankFloorLayouts } from '../project/floorPreference';
import type { NormalizedIfcPlan, NormalizedIfcRoom } from './normalizedPlan';

export interface FloorStrategyObservation {
  ref: string;
  metric:
    | 'wc-cluster'
    | 'wc-dispersion'
    | 'internal-corridor-count'
    | 'corridor-width-main'
    | 'corridor-width-side'
    | 'corridor-ratio';
  value: number;
}

export interface FloorStrategyProfile {
  name: string;
  preferClusteredWc: number;
  preferSpreadWc: number;
  preferInternalCorridors: number;
  mainCorridorWidth: number;
  sideCorridorWidth: number;
  corridorRatio: number;
}

export function extractFloorStrategyObservations(plan: NormalizedIfcPlan): FloorStrategyObservation[] {
  const observations: FloorStrategyObservation[] = [];
  const wcRooms = plan.rooms.filter((room) => room.roomType === 'wc');
  if (wcRooms.length > 1) {
    const dispersion = roomDispersion(wcRooms);
    observations.push({ ref: `${plan.sourceId}:wc-cluster`, metric: 'wc-cluster', value: 1 - dispersion });
    observations.push({ ref: `${plan.sourceId}:wc-dispersion`, metric: 'wc-dispersion', value: dispersion });
  }

  const mainCorridors = (plan.corridors || []).filter((corridor) => corridor.role === 'main');
  const sideCorridors = (plan.corridors || []).filter((corridor) => corridor.role === 'side');
  for (const corridor of mainCorridors) observations.push({ ref: `${plan.sourceId}:${corridor.sourceId}:main-width`, metric: 'corridor-width-main', value: corridor.width });
  for (const corridor of sideCorridors) observations.push({ ref: `${plan.sourceId}:${corridor.sourceId}:side-width`, metric: 'corridor-width-side', value: corridor.width });
  observations.push({ ref: `${plan.sourceId}:internal-corridors`, metric: 'internal-corridor-count', value: sideCorridors.length });

  const roomArea = plan.rooms.reduce((sum, room) => sum + room.w * room.d, 0);
  const corridorArea = (plan.corridors || []).reduce((sum, corridor) => sum + corridor.width * 10_000, 0);
  if (roomArea + corridorArea > 0) observations.push({ ref: `${plan.sourceId}:corridor-ratio`, metric: 'corridor-ratio', value: corridorArea / (roomArea + corridorArea) });
  return observations;
}

export function induceFloorStrategyProfile(name: string, observations: FloorStrategyObservation[]): FloorStrategyProfile {
  const avg = (metric: FloorStrategyObservation['metric'], fallback: number) => {
    const values = observations.filter((observation) => observation.metric === metric).map((observation) => observation.value);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
  };
  const cluster = avg('wc-cluster', 0.5);
  const spread = avg('wc-dispersion', 0.5);
  return {
    name,
    preferClusteredWc: cluster,
    preferSpreadWc: spread,
    preferInternalCorridors: Math.min(1, avg('internal-corridor-count', 0) / 2),
    mainCorridorWidth: avg('corridor-width-main', 1800),
    sideCorridorWidth: avg('corridor-width-side', 1200),
    corridorRatio: avg('corridor-ratio', 0.18),
  };
}

export function scoreFloorLayoutByProfile(layout: FloorLayout, profile: FloorStrategyProfile): number {
  const variant = layout.variant;
  const spreadBonus = variant.includes('spread-wc') || variant.includes('alternating') ? profile.preferSpreadWc : 0;
  const clusterBonus = variant.includes('wc-first') || variant.includes('program') ? profile.preferClusteredWc : 0;
  const internalBonus = variant.includes('center-cross') || variant.includes('thirds') ? profile.preferInternalCorridors : 0;
  const mainWidthFit = 1 - Math.min(1, Math.abs(layout.corridorPolicy.mainWidth * 1000 - profile.mainCorridorWidth) / Math.max(profile.mainCorridorWidth, 1));
  const sideWidthFit = 1 - Math.min(1, Math.abs(layout.corridorPolicy.sideWidth * 1000 - profile.sideCorridorWidth) / Math.max(profile.sideCorridorWidth, 1));
  return spreadBonus * 0.3 + clusterBonus * 0.3 + internalBonus * 0.2 + mainWidthFit * 0.12 + sideWidthFit * 0.08;
}

export function rankFloorLayoutsByProfile(layouts: FloorLayout[], profile: FloorStrategyProfile): FloorLayout[] {
  return rankFloorLayouts(layouts).sort((a, b) => scoreFloorLayoutByProfile(b, profile) - scoreFloorLayoutByProfile(a, profile));
}

function roomDispersion(rooms: NormalizedIfcRoom[]): number {
  const centers = rooms.map((room) => ({ x: room.w / 2 + (room.elements[0]?.x || 0), y: room.d / 2 + (room.elements[0]?.y || 0) }));
  let total = 0;
  let count = 0;
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      total += Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
      count++;
    }
  }
  return Math.min(1, (count ? total / count : 0) / 20_000);
}
