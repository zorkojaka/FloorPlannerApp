import { extractFloorStrategyObservations, induceFloorStrategyProfile, type FloorStrategyProfile } from '../ifc/floorStrategy';
import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import type { IfcReferenceSummary } from '../training/ifcReferenceSets';
import type { ProjectBrief, RoomProgram, RoomType, WcKind } from './roomTypes';
import { induceZoneProfile, type ZoneProfile, type ZoneStat } from './zoneInduction';

export interface ProjectTrainingResult {
  sourceId: string;
  name: string;
  brief: ProjectBrief;
  profile: FloorStrategyProfile;
  /** iz uvoza izpeljane cone (namembnost/čistost) — vpliv na generator + A/B */
  zones: ZoneStat[];
  zoneSource: ZoneProfile['source'];
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

/** Normaliziran vhod za sestavo projekta — enak za IFC in AI-ekstrakcijo. */
interface TrainingInput {
  sourceId: string;
  name: string;
  officeCount: number;
  maleCount: number;
  femaleCount: number;
  unisexCount: number;
  averageOfficeArea: number;
  averageWcArea: number;
  mainCorridorMm: number;
  sideCorridorMm: number;
  roomsCount: number;
  corridorsCount: number;
  /** načrt za indukcijo strateškega profila (WC gruča/razpršenost, hodniki) */
  plan: NormalizedIfcPlan;
}

/** Cona za program: naučena preslikava iz uvoza, sicer sklepana iz tipa. */
function programZone(type: RoomType, zoneProfile: ZoneProfile): RoomProgram['zone'] {
  return zoneProfile.zoneByType[type];
}

/** Skupno jedro: iz normaliziranega vhoda sestavi brief + profil + dokaz. */
function assembleProjectTraining(input: TrainingInput): ProjectTrainingResult {
  const zoneProfile = induceZoneProfile(input.plan);
  const wcTotal = input.maleCount + input.femaleCount + input.unisexCount;
  const programArea = input.officeCount * input.averageOfficeArea + wcTotal * input.averageWcArea;
  const corridorArea = Math.max(programArea * 0.18, input.corridorsCount * (input.mainCorridorMm / 1000) * 8);
  const targetArea = round1((programArea + corridorArea) * 1.08);
  const aspect = targetArea > 600 ? 1.25 : 1.4;
  const minimumFrontage = ((input.officeCount * 2.4 + wcTotal * 1.2) / 2) * 1.15;
  const width = round1(Math.min(120, Math.max(8, minimumFrontage, Math.sqrt(targetArea * aspect))));
  const depth = round1(Math.max(6, targetArea / width));
  const roomCandidates: RoomProgram[] = [
    wcProgram('wc-men', 'male', input.maleCount, zoneProfile),
    wcProgram('wc-women', 'female', input.femaleCount, zoneProfile),
    wcProgram('wc-unisex', 'unisex', input.unisexCount, zoneProfile),
    { id: 'office', type: 'office', count: input.officeCount, workstations: 1, areaOverride: round1(input.averageOfficeArea), zone: programZone('office', zoneProfile) },
    { id: 'corridor', type: 'corridor', count: 1, zone: programZone('corridor', zoneProfile) },
  ];
  const rooms = roomCandidates.filter((room) => room.type === 'corridor' || room.count > 0);

  return {
    sourceId: input.sourceId,
    name: input.name,
    brief: {
      id: `${input.sourceId}-project`,
      name: `${input.name} projekt`,
      boundary: { area: targetArea, width, depth },
      entrances: [{ id: 'ifc-main-entry', wall: 'S', position: 0.5, width: 1.2 }],
      corridorPolicy: {
        minWidth: round1(Math.max(0.9, input.sideCorridorMm / 1000)),
        mainWidth: round1(Math.max(input.sideCorridorMm, input.mainCorridorMm) / 1000),
        sideWidth: round1(input.sideCorridorMm / 1000),
      },
      rooms,
    },
    profile: induceFloorStrategyProfile(input.name, extractFloorStrategyObservations(input.plan)),
    zones: zoneProfile.stats,
    zoneSource: zoneProfile.source,
    evidence: {
      rooms: input.roomsCount,
      corridors: input.corridorsCount,
      wc: wcTotal,
      office: input.officeCount,
      mainCorridorMm: input.mainCorridorMm,
      sideCorridorMm: input.sideCorridorMm,
      averageOfficeArea: round1(input.averageOfficeArea),
      averageWcArea: round1(input.averageWcArea),
    },
  };
}

export function projectTrainingFromIfcSummary(summary: IfcReferenceSummary): ProjectTrainingResult {
  const officeCount = Math.max(0, summary.normalized.byType.office || 0);
  const wcTotal = Math.max(0, summary.normalized.byType.wc || 0);
  const wcKinds = summary.normalized.byWcKind || {};
  const maleCount = wcKinds.male || 0;
  const femaleCount = wcKinds.female || 0;
  const unisexCount = Math.max(0, wcTotal - maleCount - femaleCount);
  const mainCorridorMm = summary.corridorWidthsMm?.median || 1800;
  const sideCorridorMm = summary.corridorWidthsMm?.min || Math.min(mainCorridorMm, 1200);

  return assembleProjectTraining({
    sourceId: summary.id,
    name: summary.name,
    officeCount,
    maleCount,
    femaleCount,
    unisexCount,
    averageOfficeArea: averageArea(summary.sampleRooms.filter((room) => room.type === 'office'), 10),
    averageWcArea: averageArea(summary.sampleRooms.filter((room) => room.type === 'wc'), 3.2),
    mainCorridorMm,
    sideCorridorMm,
    roomsCount: summary.normalized.rooms,
    corridorsCount: summary.normalized.corridors,
    plan: normalizedPlanFromSummary(summary),
  });
}

/**
 * Druga uvozna pot: realni načrt prek AI-ekstrakcije → NormalizedIfcPlan → isti
 * projektni trening kot IFC. Enota mer v načrtu je mm (w/d prostorov, širine hodnikov).
 */
export function projectTrainingFromNormalizedPlan(plan: NormalizedIfcPlan): ProjectTrainingResult {
  const officeRooms = plan.rooms.filter((room) => room.roomType === 'office');
  const wcRooms = plan.rooms.filter((room) => room.roomType === 'wc');
  const maleCount = wcRooms.filter((room) => room.wcKind === 'male').length;
  const femaleCount = wcRooms.filter((room) => room.wcKind === 'female').length;
  const unisexCount = wcRooms.length - maleCount - femaleCount;
  const corridors = plan.corridors || [];
  const mainWidths = corridors.filter((corridor) => corridor.role === 'main').map((corridor) => corridor.width);
  const allWidths = corridors.map((corridor) => corridor.width);
  const mainCorridorMm = Math.round(median(mainWidths.length ? mainWidths : allWidths) || 1800);
  const sideCorridorMm = Math.round(allWidths.length ? Math.min(...allWidths) : Math.min(mainCorridorMm, 1200));

  return assembleProjectTraining({
    sourceId: plan.sourceId || 'ai-plan',
    name: plan.name || 'AI-ekstrahiran načrt',
    officeCount: officeRooms.length,
    maleCount,
    femaleCount,
    unisexCount,
    averageOfficeArea: averageArea(officeRooms, 10),
    averageWcArea: averageArea(wcRooms, 3.2),
    mainCorridorMm,
    sideCorridorMm,
    roomsCount: plan.rooms.length,
    corridorsCount: corridors.length,
    plan,
  });
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

function wcProgram(id: string, wcKind: WcKind, count: number, zoneProfile: ZoneProfile): RoomProgram {
  return { id, type: 'wc', wcKind, count, areaOverride: wcKind === 'male' ? 3.8 : 3.2, zone: programZone('wc', zoneProfile) };
}

function averageArea(rooms: Array<{ w: number; d: number }>, fallback: number): number {
  if (!rooms.length) return fallback;
  return rooms.reduce((sum, room) => sum + (room.w * room.d) / 1_000_000, 0) / rooms.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
