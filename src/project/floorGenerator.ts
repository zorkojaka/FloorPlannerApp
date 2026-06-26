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
  id: string;
  variant: string;
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

export interface FloorLayoutOptions {
  id?: string;
  corridorWidth?: number;
  corridorSide?: 'north' | 'south';
  roomOrder?: 'program' | 'reverse' | 'offices-first' | 'wc-first';
}

export function generateStripFloorLayout(brief: ProjectBrief, options: FloorLayoutOptions | number = {}): FloorLayout {
  const opts: FloorLayoutOptions = typeof options === 'number' ? { corridorWidth: options } : options;
  const corridorWidth = opts.corridorWidth ?? 1.4;
  const corridorSide = opts.corridorSide ?? 'south';
  const roomOrder = opts.roomOrder ?? 'program';
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
    y: corridorSide === 'south' ? 0 : boundary.depth - corridorWidth,
    w: boundary.width,
    d: corridorWidth,
    area: boundary.width * corridorWidth,
    doorToCorridor: false,
  };

  const roomDepth = Math.max(0, boundary.depth - corridorWidth);
  const rooms: PlacedRoom[] = [];
  let cursorX = 0;

  for (const program of orderPrograms(expandPrograms(brief.rooms), roomOrder)) {
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
      y: corridorSide === 'south' ? corridorWidth : 0,
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
    id: opts.id ?? `${roomOrder}-${corridorSide}-${corridorWidth}`,
    variant: `${roomOrder} · hodnik ${corridorSide === 'south' ? 'spodaj' : 'zgoraj'} · ${corridorWidth.toFixed(1)} m`,
    boundary,
    rooms,
    corridor,
    fitsBoundary: warnings.length === 0 && usedArea <= boundary.area,
    remainingArea: roundToGrid(boundary.area - usedArea),
    warnings,
  };
}

export function generateFloorLayoutPool(brief: ProjectBrief): FloorLayout[] {
  const variants: FloorLayoutOptions[] = [];
  for (const corridorSide of ['south', 'north'] as const) {
    for (const roomOrder of ['program', 'reverse', 'offices-first', 'wc-first'] as const) {
      for (const corridorWidth of [1.2, 1.4, 1.8]) {
        variants.push({ corridorSide, roomOrder, corridorWidth, id: `${corridorSide}-${roomOrder}-${corridorWidth}` });
      }
    }
  }
  const unique = new Map<string, FloorLayout>();
  for (const variant of variants) {
    const layout = generateStripFloorLayout(brief, variant);
    const key = layout.rooms.map((room) => `${room.type}:${room.x}:${room.y}:${room.w}:${room.d}`).join('|') + `|${layout.corridor.y}:${layout.corridor.d}`;
    if (!unique.has(key)) unique.set(key, layout);
  }
  return [...unique.values()];
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

function orderPrograms(programs: RoomProgram[], order: FloorLayoutOptions['roomOrder']): RoomProgram[] {
  const nonCorridors = programs.filter((program) => program.type !== 'corridor');
  if (order === 'reverse') return [...nonCorridors].reverse();
  if (order === 'offices-first') return [...nonCorridors].sort((a, b) => Number(b.type === 'office') - Number(a.type === 'office'));
  if (order === 'wc-first') return [...nonCorridors].sort((a, b) => Number(b.type === 'wc') - Number(a.type === 'wc'));
  return nonCorridors;
}

function roundToGrid(value: number, grid = 0.1): number {
  return Math.round(value / grid) * grid;
}
