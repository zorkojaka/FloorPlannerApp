import { estimateProjectArea, estimateRoomProgramArea, ROOM_TYPE_DEFINITIONS, type CorridorPolicy, type ProjectBrief, type ProjectEntrance, type RoomProgram, type RoomType } from './roomTypes';

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
  corridorLinks: PlacedRoom[];
  corridorPolicy: CorridorPolicy;
  entrances: ProjectEntrance[];
  fitsBoundary: boolean;
  remainingArea: number;
  warnings: string[];
}

export interface FloorLayoutOptions {
  id?: string;
  corridorWidth?: number;
  corridorSide?: 'north' | 'south' | 'west' | 'east';
  roomOrder?: 'program' | 'reverse' | 'offices-first' | 'wc-first';
}

export function generateStripFloorLayout(brief: ProjectBrief, options: FloorLayoutOptions | number = {}): FloorLayout {
  const opts: FloorLayoutOptions = typeof options === 'number' ? { corridorWidth: options } : options;
  const corridorPolicy = normalizeCorridorPolicy(brief, opts.corridorWidth);
  const corridorWidth = corridorPolicy.mainWidth;
  const sideCorridorWidth = corridorPolicy.sideWidth;
  const entrances = normalizeEntrances(brief);
  const primaryEntrance = entrances[0];
  const corridorSide = opts.corridorSide ?? sideFromEntrance(primaryEntrance);
  const roomOrder = opts.roomOrder ?? 'program';
  const boundary = resolveBoundary(brief);
  const warnings: string[] = [];
  const summary = estimateProjectArea(brief);
  if (!summary.fitsBoundary) warnings.push('Estimated program area exceeds project boundary.');
  if (boundary.depth <= corridorWidth) warnings.push('Boundary depth is too small for corridor.');

  const verticalCorridor = corridorSide === 'west' || corridorSide === 'east';
  const corridorCenter = verticalCorridor ? boundary.width / 2 : boundary.depth / 2;
  const corridor: PlacedRoom = {
    id: 'corridor-main',
    programId: 'corridor',
    type: 'corridor',
    name: ROOM_TYPE_DEFINITIONS.corridor.name,
    x: verticalCorridor ? roundToGrid(corridorCenter - corridorWidth / 2) : 0,
    y: verticalCorridor ? 0 : roundToGrid(corridorCenter - corridorWidth / 2),
    w: verticalCorridor ? corridorWidth : boundary.width,
    d: verticalCorridor ? boundary.depth : corridorWidth,
    area: (verticalCorridor ? boundary.depth : boundary.width) * corridorWidth,
    doorToCorridor: false,
  };
  const corridorLinks = buildEntranceLinks(entrances, boundary, corridor, sideCorridorWidth);

  const roomSideStart = verticalCorridor
    ? (corridor.x + corridor.w <= boundary.width / 2 ? corridor.x + corridor.w : 0)
    : (corridor.y + corridor.d <= boundary.depth / 2 ? corridor.y + corridor.d : 0);
  const roomDepth = Math.max(
    0,
    verticalCorridor
      ? (roomSideStart === 0 ? corridor.x : boundary.width - corridor.x - corridor.w)
      : (roomSideStart === 0 ? corridor.y : boundary.depth - corridor.y - corridor.d),
  );
  const rooms: PlacedRoom[] = [];
  let cursor = 0;

  for (const program of orderPrograms(expandPrograms(brief.rooms), roomOrder)) {
    const definition = ROOM_TYPE_DEFINITIONS[program.type];
    if (!definition || program.type === 'corridor') continue;
    const targetArea = estimateRoomProgramArea({ ...program, count: 1 });
    const roomWidth = Math.max(definition.minWidth, roundToGrid(targetArea / Math.max(roomDepth, definition.minDepth)));
    const width = roundToGrid(verticalCorridor ? roomDepth : roomWidth);
    const depth = roundToGrid(verticalCorridor ? roomWidth : Math.max(definition.minDepth, roomDepth));
    const area = roundToGrid(width * depth);

    rooms.push({
      id: `${program.id}-${rooms.length + 1}`,
      programId: program.id,
      type: program.type,
      name: definition.name,
      x: verticalCorridor ? roomSideStart : roundToGrid(cursor),
      y: verticalCorridor ? roundToGrid(cursor) : roomSideStart,
      w: width,
      d: depth,
      area,
      doorToCorridor: definition.corridorAccess === 'required',
    });
    cursor += verticalCorridor ? depth : width;
  }

  if (cursor > (verticalCorridor ? boundary.depth : boundary.width)) warnings.push('Rooms exceed available frontage along the corridor.');
  const usedArea = corridor.area + corridorLinks.reduce((sum, link) => sum + link.area, 0) + rooms.reduce((sum, room) => sum + room.area, 0);

  return {
    id: opts.id ?? `${roomOrder}-${corridorSide}-${corridorWidth}`,
    variant: `${roomOrder} · hodnik ${corridorLabel(corridorSide)} · ${corridorWidth.toFixed(1)} m`,
    boundary,
    rooms,
    corridor,
    corridorLinks,
    corridorPolicy,
    entrances,
    fitsBoundary: warnings.length === 0 && usedArea <= boundary.area,
    remainingArea: roundToGrid(boundary.area - usedArea),
    warnings,
  };
}

export function generateFloorLayoutPool(brief: ProjectBrief): FloorLayout[] {
  const variants: FloorLayoutOptions[] = [];
  const sides = brief.entrances?.length ? [sideFromEntrance(normalizeEntrances(brief)[0])] : ['south', 'north'];
  for (const corridorSide of sides as Array<'south' | 'north' | 'west' | 'east'>) {
    for (const roomOrder of ['program', 'reverse', 'offices-first', 'wc-first'] as const) {
      for (const corridorWidth of corridorWidthVariants(brief)) {
        variants.push({ corridorSide, roomOrder, corridorWidth, id: `${corridorSide}-${roomOrder}-${corridorWidth}` });
      }
    }
  }
  const unique = new Map<string, FloorLayout>();
  for (const variant of variants) {
    const layout = generateStripFloorLayout(brief, variant);
    const key = layout.rooms.map((room) => `${room.type}:${room.x}:${room.y}:${room.w}:${room.d}`).join('|') + `|${layout.corridor.x}:${layout.corridor.y}:${layout.corridor.w}:${layout.corridor.d}|${layout.corridorLinks.map((link) => `${link.x}:${link.y}:${link.w}:${link.d}`).join('|')}`;
    if (!unique.has(key)) unique.set(key, layout);
  }
  return [...unique.values()];
}

function normalizeCorridorPolicy(brief: ProjectBrief, candidateMainWidth?: number): CorridorPolicy {
  const base = brief.corridorPolicy || { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 };
  const minWidth = Math.max(0.8, base.minWidth || 1.2);
  const mainWidth = Math.max(minWidth, candidateMainWidth ?? base.mainWidth ?? minWidth);
  const sideWidth = Math.max(minWidth, Math.min(base.sideWidth ?? minWidth, mainWidth));
  return { minWidth, mainWidth, sideWidth };
}

function corridorWidthVariants(brief: ProjectBrief): number[] {
  const policy = normalizeCorridorPolicy(brief);
  const widths = [policy.mainWidth, policy.mainWidth + 0.4, Math.max(policy.minWidth, policy.mainWidth - 0.3)];
  return [...new Set(widths.map((width) => roundToGrid(width)).filter((width) => width >= policy.minWidth))];
}

function buildEntranceLinks(
  entrances: ProjectEntrance[],
  boundary: FloorLayout['boundary'],
  corridor: PlacedRoom,
  corridorWidth: number,
): PlacedRoom[] {
  return entrances.map((entrance, index) => {
    const point = entrancePoint(entrance, boundary);
    const half = corridorWidth / 2;
    if (entrance.wall === 'N' || entrance.wall === 'S') {
      const targetY = entrance.wall === 'S' ? corridor.y : corridor.y + corridor.d;
      const y = Math.min(point.y, targetY);
      const d = Math.max(corridorWidth, Math.abs(point.y - targetY));
      return corridorLink(index, point.x - half, y, corridorWidth, d);
    }
    const targetX = entrance.wall === 'W' ? corridor.x : corridor.x + corridor.w;
    const x = Math.min(point.x, targetX);
    const w = Math.max(corridorWidth, Math.abs(point.x - targetX));
    return corridorLink(index, x, point.y - half, w, corridorWidth);
  });
}

function entrancePoint(entrance: ProjectEntrance, boundary: FloorLayout['boundary']): { x: number; y: number } {
  const pos = Math.max(0, Math.min(1, entrance.position));
  if (entrance.wall === 'N') return { x: boundary.width * pos, y: boundary.depth };
  if (entrance.wall === 'S') return { x: boundary.width * pos, y: 0 };
  if (entrance.wall === 'E') return { x: boundary.width, y: boundary.depth * pos };
  return { x: 0, y: boundary.depth * pos };
}

function corridorLink(index: number, x: number, y: number, w: number, d: number): PlacedRoom {
  return {
    id: `corridor-link-${index + 1}`,
    programId: 'corridor',
    type: 'corridor',
    name: 'Hodnik',
    x: roundToGrid(Math.max(0, x)),
    y: roundToGrid(Math.max(0, y)),
    w: roundToGrid(w),
    d: roundToGrid(d),
    area: roundToGrid(w * d),
    doorToCorridor: false,
  };
}

function normalizeEntrances(brief: ProjectBrief): ProjectEntrance[] {
  const entrances = brief.entrances?.length ? brief.entrances : [{ id: 'entry-1', wall: 'S' as const, position: 0.5, width: 1.2 }];
  return entrances.map((entrance, index) => ({
    id: entrance.id || `entry-${index + 1}`,
    wall: entrance.wall,
    position: Math.max(0, Math.min(1, entrance.position)),
    width: entrance.width || 1.2,
  }));
}

function sideFromEntrance(entrance: ProjectEntrance): NonNullable<FloorLayoutOptions['corridorSide']> {
  if (entrance.wall === 'N') return 'north';
  if (entrance.wall === 'E') return 'east';
  if (entrance.wall === 'W') return 'west';
  return 'south';
}

function corridorLabel(side: NonNullable<FloorLayoutOptions['corridorSide']>): string {
  return ({ south: 'spodaj', north: 'zgoraj', west: 'levo', east: 'desno' })[side];
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
