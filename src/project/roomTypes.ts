export type RoomType = 'wc' | 'office' | 'corridor';

export interface RoomTypeDefinition {
  type: RoomType;
  name: string;
  minArea: number;
  preferredArea: number;
  minWidth: number;
  minDepth: number;
  needsWindow: boolean;
  needsWetWall: boolean;
  corridorAccess: 'required' | 'none';
}

export interface RoomProgram {
  id: string;
  type: RoomType;
  count: number;
  workstations?: number;
  areaOverride?: number;
}

export interface ProjectBoundary {
  area: number;
  width?: number;
  depth?: number;
}

export interface ProjectBrief {
  id: string;
  name: string;
  boundary: ProjectBoundary;
  rooms: RoomProgram[];
}

export interface ProgramAreaSummary {
  roomArea: number;
  corridorArea: number;
  totalArea: number;
  fitsBoundary: boolean;
  remainingArea: number;
}

export const ROOM_TYPE_DEFINITIONS: Record<RoomType, RoomTypeDefinition> = {
  wc: {
    type: 'wc',
    name: 'WC',
    minArea: 2.4,
    preferredArea: 3.2,
    minWidth: 1.2,
    minDepth: 1.8,
    needsWindow: false,
    needsWetWall: true,
    corridorAccess: 'required',
  },
  office: {
    type: 'office',
    name: 'Pisarna',
    minArea: 7.5,
    preferredArea: 10,
    minWidth: 2.4,
    minDepth: 2.8,
    needsWindow: true,
    needsWetWall: false,
    corridorAccess: 'required',
  },
  corridor: {
    type: 'corridor',
    name: 'Hodnik',
    minArea: 0,
    preferredArea: 0,
    minWidth: 1.2,
    minDepth: 1.2,
    needsWindow: false,
    needsWetWall: false,
    corridorAccess: 'none',
  },
};

export function validateProjectBrief(brief: ProjectBrief): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(brief.boundary.area) || brief.boundary.area <= 0) errors.push('Project boundary area must be positive.');
  for (const room of brief.rooms) {
    if (!ROOM_TYPE_DEFINITIONS[room.type]) errors.push(`Unsupported room type: ${room.type}`);
    if (!Number.isInteger(room.count) || room.count < 0) errors.push(`Room ${room.id} count must be a non-negative integer.`);
    if (room.workstations !== undefined && (!Number.isInteger(room.workstations) || room.workstations < 0)) errors.push(`Room ${room.id} workstations must be a non-negative integer.`);
    if (room.areaOverride !== undefined && (!Number.isFinite(room.areaOverride) || room.areaOverride <= 0)) errors.push(`Room ${room.id} areaOverride must be positive.`);
  }
  return errors;
}

export function estimateRoomProgramArea(room: RoomProgram): number {
  const definition = ROOM_TYPE_DEFINITIONS[room.type];
  if (!definition || room.count <= 0) return 0;
  if (room.type === 'corridor') return 0;
  if (room.areaOverride) return room.areaOverride * room.count;
  if (room.type === 'office') {
    const workstations = Math.max(1, room.workstations ?? 1);
    return Math.max(definition.minArea, definition.preferredArea * workstations) * room.count;
  }
  return definition.preferredArea * room.count;
}

export function estimateProjectArea(brief: ProjectBrief, corridorRatio = 0.18): ProgramAreaSummary {
  const roomArea = brief.rooms.reduce((sum, room) => sum + estimateRoomProgramArea(room), 0);
  const explicitCorridorArea = brief.rooms
    .filter((room) => room.type === 'corridor')
    .reduce((sum, room) => sum + (room.areaOverride ?? 0) * room.count, 0);
  const corridorArea = explicitCorridorArea || roomArea * corridorRatio;
  const totalArea = roomArea + corridorArea;
  return {
    roomArea,
    corridorArea,
    totalArea,
    fitsBoundary: totalArea <= brief.boundary.area,
    remainingArea: brief.boundary.area - totalArea,
  };
}
