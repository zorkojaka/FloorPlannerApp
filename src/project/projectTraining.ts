import { extractFloorStrategyObservations, induceFloorStrategyProfile, type FloorStrategyProfile } from '../ifc/floorStrategy';
import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import type { IfcReferenceSummary } from '../training/ifcReferenceSets';
import type { ProjectBrief, RoomProgram, WcKind } from './roomTypes';

export interface ProjectTrainingResult {
  sourceId: string;
  name: string;
  brief: ProjectBrief;
  profile: FloorStrategyProfile;
  evidence: {
    rooms: number;
    corridors: number;
    wc: number;
    office: number;
    mainCorridorMm: number;
    sideCorridorMm: number;
    averageOfficeArea: number;
    averageWcArea: number;
  };
}

export function projectTrainingFromIfcSummary(summary: IfcReferenceSummary): ProjectTrainingResult {
  const officeCount = Math.max(0, summary.normalized.byType.office || 0);
  const wcTotal = Math.max(0, summary.normalized.byType.wc || 0);
  const wcKinds = summary.normalized.byWcKind || {};
  const maleCount = wcKinds.male || 0;
  const femaleCount = wcKinds.female || 0;
  const unisexCount = Math.max(0, wcTotal - maleCount - femaleCount);
  const averageOfficeArea = averageArea(summary.sampleRooms.filter((room) => room.type === 'office'), 10);
  const averageWcArea = averageArea(summary.sampleRooms.filter((room) => room.type === 'wc'), 3.2);
  const mainCorridorMm = summary.corridorWidthsMm?.median || 1800;
  const sideCorridorMm = summary.corridorWidthsMm?.min || Math.min(mainCorridorMm, 1200);
  const programArea = officeCount * averageOfficeArea + wcTotal * averageWcArea;
  const corridorArea = Math.max(programArea * 0.18, summary.normalized.corridors * (mainCorridorMm / 1000) * 8);
  const targetArea = round1((programArea + corridorArea) * 1.08);
  const aspect = targetArea > 600 ? 1.25 : 1.4;
  const minimumFrontage = ((officeCount * 2.4 + wcTotal * 1.2) / 2) * 1.15;
  const width = round1(Math.min(120, Math.max(8, minimumFrontage, Math.sqrt(targetArea * aspect))));
  const depth = round1(Math.max(6, targetArea / width));
  const roomCandidates: RoomProgram[] = [
    wcProgram('wc-men', 'male', maleCount),
    wcProgram('wc-women', 'female', femaleCount),
    wcProgram('wc-unisex', 'unisex', unisexCount),
    { id: 'office', type: 'office', count: officeCount, workstations: 1, areaOverride: round1(averageOfficeArea) },
    { id: 'corridor', type: 'corridor', count: 1 },
  ];
  const rooms = roomCandidates.filter((room) => room.type === 'corridor' || room.count > 0);

  const plan = normalizedPlanFromSummary(summary);
  return {
    sourceId: summary.id,
    name: summary.name,
    brief: {
      id: `${summary.id}-project`,
      name: `${summary.name} projekt`,
      boundary: { area: targetArea, width, depth },
      entrances: [{ id: 'ifc-main-entry', wall: 'S', position: 0.5, width: 1.2 }],
      corridorPolicy: {
        minWidth: round1(Math.max(0.9, sideCorridorMm / 1000)),
        mainWidth: round1(Math.max(sideCorridorMm, mainCorridorMm) / 1000),
        sideWidth: round1(sideCorridorMm / 1000),
      },
      rooms,
    },
    profile: induceFloorStrategyProfile(summary.name, extractFloorStrategyObservations(plan)),
    evidence: {
      rooms: summary.normalized.rooms,
      corridors: summary.normalized.corridors,
      wc: wcTotal,
      office: officeCount,
      mainCorridorMm,
      sideCorridorMm,
      averageOfficeArea: round1(averageOfficeArea),
      averageWcArea: round1(averageWcArea),
    },
  };
}

function normalizedPlanFromSummary(summary: IfcReferenceSummary): NormalizedIfcPlan {
  return {
    sourceId: summary.id,
    name: summary.name,
    corridors: summary.sampleCorridors.map((corridor) => ({
      sourceId: corridor.sourceId,
      name: corridor.name,
      role: corridor.role,
      width: corridor.width,
    })),
    rooms: summary.sampleRooms.map((room, index) => ({
      sourceId: `${summary.id}-room-${index + 1}`,
      name: room.name,
      roomType: room.type === 'corridor' ? 'office' : room.type,
      wcKind: room.wcKind,
      w: room.w,
      d: room.d,
      elements: room.type === 'wc'
        ? [{ sourceId: `${summary.id}-wc-${index + 1}`, name: 'WC', elementKey: 'toilet', x: index * 3500, y: 0, w: 400, d: 600, facing: 'N' }]
        : [],
    })),
  };
}

function wcProgram(id: string, wcKind: WcKind, count: number): RoomProgram {
  return { id, type: 'wc', wcKind, count, areaOverride: wcKind === 'male' ? 3.8 : 3.2 };
}

function averageArea(rooms: Array<{ w: number; d: number }>, fallback: number): number {
  if (!rooms.length) return fallback;
  return rooms.reduce((sum, room) => sum + (room.w * room.d) / 1_000_000, 0) / rooms.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
