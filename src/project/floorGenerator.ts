import { estimateProjectArea, estimateRoomProgramArea, ROOM_TYPE_DEFINITIONS, type ProjectBrief, type RoomProgram, type RoomType } from './roomTypes';

export interface PlacedRoom {
  id: string;
  programId: string;
  type: RoomType;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  area: number;
  doorToCorridor: boolean;
}

export interface FloorLayout {
  boundary: {
    area: number;
    width: number;
    depth: number;
  };
  rooms: PlacedRoom[];
  corridor: PlacedRoom;
  fitsBoundary: boolean;
  remainingArea: number;
  warnings: string[];
}

export function generateStripFloorLayout(brief: ProjectBrief, corridorWidth = 1.4): FloorLayout {
  const boundary = resolveBoundary(brief);
  const warnings: string[] = [];
  const summary = estimateProjectArea(brief);
  if (!summary.fitsBoundary) warnings.push('Estimated program area exceeds project boundary.');
  if (boundary.depth <= corridorWidth) warnings.push('Boundary depth is too small for corridor.');

  const corridor: PlacedRoom = {
    id: 'corridor-main',
    programId: 'corridor',
    type: 'corridor',
    name: ROOM_TYPE_DEFINITIONS.corridor.name,
    x: 0,
    y: 0,
    w: boundary.width,
    d: corridorWidth,
    area: boundary.width * corridorWidth,
    doorToCorridor: false,
  };

  const roomDepth = Math.max(0, boundary.depth - corridorWidth);
  const rooms: PlacedRoom[] = [];
  let cursorX = 0;

  for (const program of expandPrograms(brief.rooms)) {
    const definition = ROOM_TYPE_DEFINITIONS[program.type];
    if (!definition || program.type === 'corridor') continue;
    const targetArea = estimateRoomProgramArea({ ...program, count: 1 });
    const roomWidth = Math.max(definition.minWidth, roundToGrid(targetArea / Math.max(roomDepth, definition.minDepth)));
    const width = roundToGrid(roomWidth);
    const depth = roundToGrid(Math.max(definition.minDepth, roomDepth));
    const area = roundToGrid(width * depth);

    rooms.push({
      id: `${program.id}-${rooms.length + 1}`,
      programId: program.id,
      type: program.type,
      name: definition.name,
      x: roundToGrid(cursorX),
      y: corridorWidth,
      w: width,
      d: depth,
      area,
      doorToCorridor: definition.corridorAccess === 'required',
    });
    cursorX += width;
  }

  if (cursorX > boundary.width) warnings.push('Rooms exceed available frontage along the corridor.');
  const usedArea = corridor.area + rooms.reduce((sum, room) => sum + room.area, 0);

  return {
    boundary,
    rooms,
    corridor,
    fitsBoundary: warnings.length === 0 && usedArea <= boundary.area,
    remainingArea: roundToGrid(boundary.area - usedArea),
    warnings,
  };
}

function resolveBoundary(brief: ProjectBrief): FloorLayout['boundary'] {
  const width = brief.boundary.width ?? Math.sqrt(brief.boundary.area * 1.4);
  const depth = brief.boundary.depth ?? brief.boundary.area / width;
  return {
    area: brief.boundary.area,
    width: roundToGrid(width),
    depth: roundToGrid(depth),
  };
}

function expandPrograms(programs: RoomProgram[]): RoomProgram[] {
  return programs.flatMap((program) =>
    Array.from({ length: program.count }, (_, index) => ({
      ...program,
      id: program.count === 1 ? program.id : `${program.id}-${index + 1}`,
      count: 1,
    })),
  );
}

function roundToGrid(value: number, grid = 0.1): number {
  return Math.round(value / grid) * grid;
}
