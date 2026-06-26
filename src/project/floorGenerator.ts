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
  roomOrder?: 'program' | 'reverse' | 'offices-first' | 'wc-first' | 'alternating' | 'spread-wc';
  internalCorridors?: 'none' | 'center-cross' | 'thirds';
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
  const internalCorridors = opts.internalCorridors ?? 'none';
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
  const corridorLinks = [
    ...buildEntranceLinks(entrances, boundary, corridor, sideCorridorWidth),
    ...buildInternalCorridors(boundary, corridor, sideCorridorWidth, internalCorridors),
  ];

  const rooms: PlacedRoom[] = [];
  const sideDepths = verticalCorridor
    ? [corridor.x, boundary.width - corridor.x - corridor.w]
    : [corridor.y, boundary.depth - corridor.y - corridor.d];
  const frontageLimit = verticalCorridor ? boundary.depth : boundary.width;
  const sidePlans: RoomPlan[][] = [[], []];
  const sideFrontage = [0, 0];

  for (const program of orderPrograms(expandPrograms(brief.rooms), roomOrder)) {
    const definition = ROOM_TYPE_DEFINITIONS[program.type];
    if (!definition || program.type === 'corridor') continue;
    const targetArea = estimateRoomProgramArea({ ...program, count: 1 });
    const sideIndex = sideFrontage[0] <= sideFrontage[1] ? 0 : 1;
    const maxDepth = Math.max(definition.minDepth, sideDepths[sideIndex]);
    const frontage = minimumFrontageForProgram(program, targetArea, maxDepth);
    sidePlans[sideIndex].push({ program, frontage });
    sideFrontage[sideIndex] += frontage;
  }

  for (const sideIndex of [0, 1] as const) {
    const plans = sidePlans[sideIndex];
    const totalFrontage = plans.reduce((sum, plan) => sum + plan.frontage, 0);
    if (totalFrontage > frontageLimit) warnings.push('Rooms exceed available frontage along the corridor.');
    const scale = totalFrontage > 0 && totalFrontage < frontageLimit ? frontageLimit / totalFrontage : 1;
    let cursor = 0;
    for (const plan of plans) {
      const definition = ROOM_TYPE_DEFINITIONS[plan.program.type];
      const frontage = roundToGrid(plan.frontage * scale);
      const sideDepth = Math.max(definition.minDepth, sideDepths[sideIndex]);
      const width = verticalCorridor ? sideDepth : frontage;
      const depth = verticalCorridor ? frontage : sideDepth;
      const area = roundToGrid(width * depth);
      rooms.push({
        id: `${plan.program.id}-${rooms.length + 1}`,
        programId: plan.program.id,
        type: plan.program.type,
        name: definition.name,
        x: verticalCorridor ? (sideIndex === 0 ? corridor.x - width : corridor.x + corridor.w) : roundToGrid(cursor),
        y: verticalCorridor ? roundToGrid(cursor) : (sideIndex === 0 ? corridor.y - depth : corridor.y + corridor.d),
        w: width,
        d: depth,
        area,
        doorToCorridor: definition.corridorAccess === 'required',
      });
      cursor += frontage;
    }
  }

  const usedArea = corridor.area + rooms.reduce((sum, room) => sum + room.area, 0);

  return {
    id: opts.id ?? `${roomOrder}-${corridorSide}-${corridorWidth}`,
    variant: `${roomOrder} · hodnik ${corridorLabel(corridorSide)} · ${corridorWidth.toFixed(1)} m${internalCorridors !== 'none' ? ' · +' + internalCorridors : ''}`,
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
        for (const internalCorridors of ['none', 'center-cross', 'thirds'] as const) {
          variants.push({ corridorSide, roomOrder, corridorWidth, internalCorridors, id: `${corridorSide}-${roomOrder}-${corridorWidth}-${internalCorridors}` });
        }
      }
    }
    for (const roomOrder of ['alternating', 'spread-wc'] as const) {
      const corridorWidth = normalizeCorridorPolicy(brief).mainWidth;
      for (const internalCorridors of ['none', 'center-cross'] as const) {
        variants.push({ corridorSide, roomOrder, corridorWidth, internalCorridors, id: `${corridorSide}-${roomOrder}-${corridorWidth}-${internalCorridors}` });
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

function buildInternalCorridors(
  boundary: FloorLayout['boundary'],
  corridor: PlacedRoom,
  corridorWidth: number,
  mode: NonNullable<FloorLayoutOptions['internalCorridors']>,
): PlacedRoom[] {
  if (mode === 'none') return [];
  const verticalMain = corridor.d > corridor.w;
  const positions = mode === 'thirds' ? [1 / 3, 2 / 3] : [0.5];
  return positions.map((position, index) => {
    if (verticalMain) {
      const y = boundary.depth * position - corridorWidth / 2;
      return corridorLink(100 + index, 0, y, boundary.width, corridorWidth);
    }
    const x = boundary.width * position - corridorWidth / 2;
    return corridorLink(100 + index, x, 0, corridorWidth, boundary.depth);
  });
}

function normalizeCorridorPolicy(brief: ProjectBrief, candidateMainWidth?: number): CorridorPolicy {
  const base = brief.corridorPolicy || { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 };
  const minWidth = Math.max(0.8, base.minWidth || 1.2);
  const mainWidth = Math.max(minWidth, candidateMainWidth ?? base.mainWidth ?? minWidth);
  const sideWidth = Math.max(minWidth, Math.min(base.sideWidth ?? minWidth, mainWidth));
  return { minWidth, mainWidth, sideWidth };
}

interface RoomPlan {
  program: RoomProgram;
  frontage: number;
}

function minimumFrontageForProgram(program: RoomProgram, targetArea: number, maxDepth: number): number {
  const definition = ROOM_TYPE_DEFINITIONS[program.type];
  return roundToGrid(Math.max(definition.minWidth, targetArea / Math.max(maxDepth, definition.minDepth, 0.1)));
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
  if (order === 'alternating') return interleaveByType(nonCorridors);
  if (order === 'spread-wc') return spreadWetRooms(nonCorridors);
  return nonCorridors;
}

function interleaveByType(programs: RoomProgram[]): RoomProgram[] {
  const buckets = new Map<RoomType, RoomProgram[]>();
  for (const program of programs) buckets.set(program.type, [...(buckets.get(program.type) || []), program]);
  const types = [...buckets.keys()].sort();
  const result: RoomProgram[] = [];
  while (types.some((type) => (buckets.get(type) || []).length > 0)) {
    for (const type of types) {
      const next = buckets.get(type)?.shift();
      if (next) result.push(next);
    }
  }
  return result;
}

function spreadWetRooms(programs: RoomProgram[]): RoomProgram[] {
  const wet = programs.filter((program) => program.type === 'wc');
  const dry = programs.filter((program) => program.type !== 'wc');
  if (wet.length === 0 || dry.length === 0) return programs;
  const result: RoomProgram[] = [];
  const spacing = Math.max(1, Math.ceil(dry.length / wet.length));
  let wetIndex = 0;
  for (let i = 0; i < dry.length; i++) {
    if (i % spacing === 0 && wetIndex < wet.length) result.push(wet[wetIndex++]);
    result.push(dry[i]);
  }
  while (wetIndex < wet.length) result.push(wet[wetIndex++]);
  return result;
}

function roundToGrid(value: number, grid = 0.1): number {
  return Math.round(value / grid) * grid;
}
