import { estimateRoomProgramArea, ROOM_TYPE_DEFINITIONS, zoneFromType, ZONE_IDS, type CorridorPolicy, type ProjectBrief, type ProjectEntrance, type RoomProgram, type RoomType, type WcKind, type ZoneId } from './roomTypes';

export type Facing = 'N' | 'E' | 'S' | 'W';

export interface PlacedRoom {
  id: string;
  programId: string;
  type: RoomType;
  wcKind?: WcKind;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  area: number;
  doorToCorridor: boolean;
  /** rob prostora (kompas), ki se dotika hodnika — tja gredo vrata */
  doorSide?: Facing;
  /** prostor se dotika fasade → možno okno */
  hasWindow?: boolean;
  /** namembnostna/čistostna cona (iz uvoza ali sklepana iz tipa) */
  zone?: ZoneId;
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
  roomOrder?: 'program' | 'reverse' | 'offices-first' | 'wc-first' | 'alternating' | 'spread-wc' | 'zone-cluster';
  /** najgloblja dovoljena soba — pod to mejo engine doda vzporedni hodnik (več vrst, plitvejše sobe) */
  maxRoomDepth?: number;
  /** vzdolžna lega prečnega konektorja (0..1), ki poveže vzporedne hodnike z vhodom */
  connectorAt?: number;
  /** okna: prostori z zahtevo po oknu (pisarne) prednostno v zunanje vrste ob fasadi */
  windowAware?: boolean;
}

const MAX_CORRIDORS = 4;
const DEFAULT_MAX_ROOM_DEPTH = 6;
const GRID = 0.1;

interface RowSlot {
  /** koordinata roba proti izhodišču osi b (globina) */
  b0: number;
  depth: number;
  /** hodnik te vrste je pri manjši (−) ali večji (+) b-koordinati */
  towards: 1 | -1;
  /** zunanji rob vrste leži na fasadi → vsi prostori v njej lahko dobijo okno */
  exterior: boolean;
}

interface CorridorBand {
  b0: number;
  depth: number;
}

export function generateStripFloorLayout(brief: ProjectBrief, options: FloorLayoutOptions | number = {}): FloorLayout {
  const opts: FloorLayoutOptions = typeof options === 'number' ? { corridorWidth: options } : options;
  const corridorPolicy = normalizeCorridorPolicy(brief, opts.corridorWidth);
  const mainW = corridorPolicy.mainWidth;
  const connectorW = corridorPolicy.sideWidth;
  const entrances = normalizeEntrances(brief);
  const primaryEntrance = entrances[0];
  const corridorSide = opts.corridorSide ?? sideFromEntrance(primaryEntrance);
  const roomOrder = opts.roomOrder ?? 'program';
  const boundary = resolveBoundary(brief);
  const warnings: string[] = [];

  // Osnovni okvir: a = os dolžine hodnikov, b = os globine (v njej zlagamo vrste in hodnike).
  const horizontal = corridorSide === 'north' || corridorSide === 'south';
  const L = horizontal ? boundary.width : boundary.depth; // dolžina hodnika
  const Db = horizontal ? boundary.depth : boundary.width; // globina za zlaganje

  const presentTypes = new Set(brief.rooms.filter((room) => room.type !== 'corridor' && room.count > 0).map((room) => room.type));
  const minRow = Math.max(...[...presentTypes].map((type) => ROOM_TYPE_DEFINITIONS[type].minDepth), 1.5);
  const cap = Math.max(minRow, opts.maxRoomDepth ?? DEFAULT_MAX_ROOM_DEPTH);

  const plan = planCorridors(Db, mainW, cap, minRow);
  if (plan.rowDepth < minRow) warnings.push('Boundary depth is too small for corridor.');

  // Prečni konektor poveže vzporedne hodnike in doseže vhod; sobe se mu izognejo.
  const connectorCenter = clamp((opts.connectorAt ?? entranceAlong(primaryEntrance, boundary, horizontal) / Math.max(L, 1)), 0, 1) * L;
  const ca0 = roundToGrid(clamp(connectorCenter - connectorW / 2, 0, L - connectorW));
  const ca1 = roundToGrid(ca0 + connectorW);

  const toXY = (a: number, b: number, la: number, lb: number) =>
    horizontal ? { x: a, y: b, w: la, d: lb } : { x: b, y: a, w: lb, d: la };

  // Hodniki: vzporedne "veje" (rungs) + prečni konektor (hrbtenica).
  const corridorRects: PlacedRoom[] = [];
  plan.corridors.forEach((band, index) => {
    const r = toXY(0, band.b0, L, band.depth);
    corridorRects.push(corridorRoom(`corridor-main${index === 0 ? '' : '-' + (index + 1)}`, r));
  });
  const connectorRect = toXY(ca0, 0, connectorW, Db);
  const connector = corridorRoom('corridor-connector', connectorRect);

  // Vrste sob (v osi b) — vsaka meji na svoj hodnik.
  const rows = plan.rows;
  const runsPerRow = [ [0, ca0], [ca1, L] ].filter(([s, e]) => e - s >= 0.8) as Array<[number, number]>;
  const usable = runsPerRow.reduce((sum, [s, e]) => sum + (e - s), 0);

  const programs = orderPrograms(expandPrograms(brief.rooms), roomOrder).filter((program) => program.type !== 'corridor');
  const frontageOf = (program: RoomProgram, depth: number) => minimumFrontageForProgram(program, estimateRoomProgramArea({ ...program, count: 1 }), depth);
  const rowPlans: Array<Array<{ program: RoomProgram; frontage: number }>> = rows.map(() => []);
  const avgDepth = rows.length ? rows.reduce((sum, row) => sum + row.depth, 0) / rows.length : plan.rowDepth;

  if (opts.windowAware) {
    // okna: prostori z oknom (pisarne) prednostno v zunanje vrste (ob fasadi), ostali (WC) v notranje
    const rowRemaining = rows.map(() => usable);
    const windowRows = rows.map((_, i) => i).filter((i) => rows[i].exterior);
    const interiorRows = rows.map((_, i) => i).filter((i) => !rows[i].exterior);
    const pickRow = (frontage: number, priority: number[]): number => {
      const order = priority.length ? priority : rows.map((_, i) => i);
      return order.find((i) => rowRemaining[i] >= frontage - 0.01) ?? order.find((i) => rowRemaining[i] > 0.01) ?? order[order.length - 1];
    };
    for (const program of programs) {
      const priority = ROOM_TYPE_DEFINITIONS[program.type].needsWindow ? [...windowRows, ...interiorRows] : [...interiorRows, ...windowRows];
      const frontage = frontageOf(program, rows[priority[0] ?? 0]?.depth ?? plan.rowDepth);
      const rowIndex = pickRow(frontage, priority);
      rowPlans[rowIndex].push({ program, frontage });
      rowRemaining[rowIndex] -= frontage;
    }
  } else {
    // privzeto: zaporedno polnjenje do povprečja (ohrani lokalnost reda → cone/WC dispergiranje delujeta)
    const totalFrontage = programs.reduce((sum, program) => sum + frontageOf(program, avgDepth), 0);
    const targetPerRow = rows.length ? totalFrontage / rows.length : totalFrontage;
    const rowLoad = rows.map(() => 0);
    let rowIndex = 0;
    for (const program of programs) {
      while (rowIndex < rows.length - 1 && rowLoad[rowIndex] >= targetPerRow - 0.01) rowIndex++;
      const frontage = frontageOf(program, rows[rowIndex].depth);
      rowPlans[rowIndex].push({ program, frontage });
      rowLoad[rowIndex] += frontage;
    }
  }

  const rooms: PlacedRoom[] = [];
  rows.forEach((row, rowIndex) => {
    const runs = runsPerRow.length ? runsPerRow : [[0, L] as [number, number]];
    const buckets: Array<Array<{ program: RoomProgram; frontage: number }>> = runs.map(() => []);
    const bucketLen = runs.map(() => 0);
    for (const plan of rowPlans[rowIndex]) {
      const bi = bucketLen.map((len, i) => len / (runs[i][1] - runs[i][0])).reduce((best, ratio, i, arr) => (ratio < arr[best] ? i : best), 0);
      buckets[bi].push(plan);
      bucketLen[bi] += plan.frontage;
    }
    runs.forEach(([start, end], bi) => {
      const runLen = end - start;
      const total = bucketLen[bi];
      if (total > runLen + 0.05) warnings.push('Rooms exceed available frontage along the corridor.');
      const scale = total > 0 && total < runLen ? Math.min(1.6, runLen / total) : 1;
      let cursor = start;
      for (const plan of buckets[bi]) {
        const frontage = roundToGrid(plan.frontage * scale);
        const rect = toXY(cursor, row.b0, frontage, row.depth);
        rooms.push({
          id: `${plan.program.id}-${rooms.length + 1}`,
          programId: plan.program.id,
          type: plan.program.type,
          wcKind: plan.program.wcKind,
          name: roomName(plan.program),
          x: roundToGrid(rect.x),
          y: roundToGrid(rect.y),
          w: roundToGrid(rect.w),
          d: roundToGrid(rect.d),
          area: roundToGrid(rect.w * rect.d),
          doorToCorridor: false,
          zone: plan.program.zone ?? zoneFromType(plan.program.type),
        });
        cursor += frontage;
      }
    });
  });

  const allCorridors = [...corridorRects, connector];
  // Vrata: geometrijsko na rob, ki se dotika hodnika. Okno: prostor se dotika fasade.
  // (okno je mehka kakovost, ne "ne gre v okvir" — zato ne gre med warnings, ampak v A/B signal + izris)
  for (const room of rooms) {
    const side = facingCorridor(room, allCorridors);
    room.doorSide = side ?? undefined;
    room.doorToCorridor = side !== null;
    if (!side) warnings.push(`Room ${room.id} has no corridor at its door.`);
    room.hasWindow = touchesBoundary(room, boundary);
  }

  // Hodniki se križajo (veje × konektor) — presek odštejemo, da ne dvojno štejemo.
  const roomsArea = rooms.reduce((sum, room) => sum + room.area, 0);
  const crossOverlap = corridorRects.reduce((sum, c) => sum + rectOverlapArea(c, connector), 0);
  const corridorArea = corridorRects.reduce((sum, c) => sum + c.area, 0) + connector.area - crossOverlap;
  const usedArea = corridorArea + roomsArea;
  const [mainCorridor, ...restCorridors] = corridorRects;

  return {
    id: opts.id ?? `${roomOrder}-${corridorSide}-${plan.corridors.length}c-${mainW}`,
    variant: `${roomOrder} · ${plan.singleLoaded ? 'enojni' : plan.corridors.length + '×'} hodnik ${orientationLabel(corridorSide)} · ${mainW.toFixed(1)} m · globina ${plan.rowDepth.toFixed(1)} m${opts.windowAware ? ' · okna' : ''}`,
    boundary,
    rooms,
    corridor: mainCorridor,
    corridorLinks: [...restCorridors, connector],
    corridorPolicy,
    entrances,
    fitsBoundary: warnings.length === 0 && rooms.length > 0 && usable > 0,
    remainingArea: roundToGrid(boundary.area - usedArea),
    warnings: [...new Set(warnings)],
  };
}

function rectOverlapArea(a: PlacedRoom, b: PlacedRoom): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.d, b.y + b.d) - Math.max(a.y, b.y));
  return w * h;
}

/** Se prostor dotika zunanjega zidu etaže (možno okno)? */
function touchesBoundary(room: PlacedRoom, boundary: FloorLayout['boundary']): boolean {
  const t = 0.05;
  return room.x <= t || room.y <= t || room.x + room.w >= boundary.width - t || room.y + room.d >= boundary.depth - t;
}

/** Koliko vzporednih hodnikov in kako globoke vrste, da nobena soba ni globlja od cap. */
function planCorridors(Db: number, mainW: number, cap: number, minRow: number): { corridors: CorridorBand[]; rows: RowSlot[]; rowDepth: number; singleLoaded: boolean } {
  const corridors: CorridorBand[] = [];
  const rows: RowSlot[] = [];
  // pasove zlagamo po skupni zaokroženi mreži, da robovi sob in hodnikov točno sovpadajo
  let start = 0;
  const band = (depth: number): [number, number] => {
    const end = roundToGrid(start + depth);
    const seg: [number, number] = [start, end];
    start = end;
    return seg;
  };

  const isExterior = (edge: number) => edge <= 0.05 || edge >= Db - 0.05;

  // enojno naložen hodnik ob robu, če je globina premajhna za dve vrsti
  if (Db < mainW + 2 * minRow) {
    const [c0, c1] = band(mainW);
    corridors.push({ b0: c0, depth: c1 - c0 });
    const rowDepth = roundToGrid(Db - (c1 - c0));
    if (rowDepth > 0) rows.push({ b0: start, depth: rowDepth, towards: -1, exterior: true });
    return { corridors, rows, rowDepth, singleLoaded: true };
  }

  const slabCap = 2 * cap + mainW;
  let k = Math.max(1, Math.round(Db / slabCap));
  for (let guard = 0; guard < 8; guard++) {
    const rowDepth = (Db / k - mainW) / 2;
    if (rowDepth > cap && k < MAX_CORRIDORS) k++;
    else if (rowDepth < minRow && k > 1) k--;
    else break;
  }
  k = Math.min(MAX_CORRIDORS, Math.max(1, k));
  const slabDepth = Db / k;
  const rowDepth = (slabDepth - mainW) / 2;
  for (let s = 0; s < k; s++) {
    const [t0, t1] = band(rowDepth);
    rows.push({ b0: t0, depth: t1 - t0, towards: 1, exterior: isExterior(t0) });
    const [c0, c1] = band(mainW);
    corridors.push({ b0: c0, depth: c1 - c0 });
    const [b0, b1] = band(rowDepth);
    rows.push({ b0, depth: b1 - b0, towards: -1, exterior: isExterior(b1) });
  }
  return { corridors, rows, rowDepth, singleLoaded: false };
}

/** Stran prostora (kompas), ki meji na kateri koli hodnik, sicer null. */
function facingCorridor(room: PlacedRoom, corridors: PlacedRoom[]): Facing | null {
  const t = 0.15;
  for (const c of corridors) {
    const vOverlap = Math.min(room.y + room.d, c.y + c.d) - Math.max(room.y, c.y);
    const hOverlap = Math.min(room.x + room.w, c.x + c.w) - Math.max(room.x, c.x);
    if (Math.abs(room.y - (c.y + c.d)) < t && hOverlap > 0.4) return 'N';
    if (Math.abs(room.y + room.d - c.y) < t && hOverlap > 0.4) return 'S';
    if (Math.abs(room.x + room.w - c.x) < t && vOverlap > 0.4) return 'E';
    if (Math.abs(room.x - (c.x + c.w)) < t && vOverlap > 0.4) return 'W';
  }
  return null;
}

export function generateFloorLayoutPool(brief: ProjectBrief): FloorLayout[] {
  const variants: FloorLayoutOptions[] = [];
  const sides = brief.entrances?.length ? [sideFromEntrance(normalizeEntrances(brief)[0])] : (['south', 'north'] as const);
  const depthVariants = [DEFAULT_MAX_ROOM_DEPTH, 3.5]; // globlje sobe (manj hodnikov) vs. plitve (več hodnikov)
  for (const corridorSide of sides as Array<'south' | 'north' | 'west' | 'east'>) {
    for (const roomOrder of ['program', 'reverse', 'offices-first', 'wc-first'] as const) {
      for (const corridorWidth of corridorWidthVariants(brief)) {
        for (const maxRoomDepth of depthVariants) {
          for (const windowAware of [false, true] as const) {
            variants.push({ corridorSide, roomOrder, corridorWidth, maxRoomDepth, windowAware, id: `${corridorSide}-${roomOrder}-${corridorWidth}-d${maxRoomDepth}${windowAware ? '-win' : ''}` });
          }
        }
      }
    }
    for (const roomOrder of ['alternating', 'spread-wc', 'zone-cluster'] as const) {
      const corridorWidth = normalizeCorridorPolicy(brief).mainWidth;
      for (const connectorAt of [0.5, 0.12] as const) {
        variants.push({ corridorSide, roomOrder, corridorWidth, connectorAt, id: `${corridorSide}-${roomOrder}-${corridorWidth}-conn${connectorAt}` });
      }
    }
  }
  const unique = new Map<string, FloorLayout>();
  for (const variant of variants) {
    const layout = generateStripFloorLayout(brief, variant);
    const key = layout.rooms.map((room) => `${room.type}:${room.x}:${room.y}:${room.w}:${room.d}`).join('|')
      + '|' + [layout.corridor, ...layout.corridorLinks].map((c) => `${c.x}:${c.y}:${c.w}:${c.d}`).join('/');
    if (!unique.has(key)) unique.set(key, layout);
  }
  return [...unique.values()];
}

function corridorRoom(id: string, rect: { x: number; y: number; w: number; d: number }): PlacedRoom {
  return {
    id,
    programId: 'corridor',
    type: 'corridor',
    name: ROOM_TYPE_DEFINITIONS.corridor.name,
    x: roundToGrid(rect.x),
    y: roundToGrid(rect.y),
    w: roundToGrid(rect.w),
    d: roundToGrid(rect.d),
    area: roundToGrid(rect.w * rect.d),
    doorToCorridor: false,
  };
}

function normalizeCorridorPolicy(brief: ProjectBrief, candidateMainWidth?: number): CorridorPolicy {
  const base = brief.corridorPolicy || { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 };
  const minWidth = Math.max(0.8, base.minWidth || 1.2);
  const mainWidth = Math.max(minWidth, candidateMainWidth ?? base.mainWidth ?? minWidth);
  const sideWidth = Math.max(minWidth, Math.min(base.sideWidth ?? minWidth, mainWidth));
  return { minWidth, mainWidth, sideWidth };
}

function minimumFrontageForProgram(program: RoomProgram, targetArea: number, rowDepth: number): number {
  const definition = ROOM_TYPE_DEFINITIONS[program.type];
  const minWidth = program.type === 'wc' && (program.wcKind === 'male' || program.wcKind === 'female') ? 2.4 : definition.minWidth;
  return roundToGrid(Math.max(minWidth, targetArea / Math.max(rowDepth, definition.minDepth, 0.1)));
}

function corridorWidthVariants(brief: ProjectBrief): number[] {
  const policy = normalizeCorridorPolicy(brief);
  const widths = [policy.mainWidth, policy.mainWidth + 0.4, Math.max(policy.minWidth, policy.mainWidth - 0.3)];
  return [...new Set(widths.map((width) => roundToGrid(width)).filter((width) => width >= policy.minWidth))];
}

function entranceAlong(entrance: ProjectEntrance, boundary: FloorLayout['boundary'], horizontal: boolean): number {
  const pos = Math.max(0, Math.min(1, entrance.position));
  if (horizontal) return boundary.width * pos;
  return boundary.depth * pos;
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

function orientationLabel(side: NonNullable<FloorLayoutOptions['corridorSide']>): string {
  return side === 'west' || side === 'east' ? 'navpičen' : 'vodoraven';
}

function roomName(program: RoomProgram): string {
  if (program.type !== 'wc') return ROOM_TYPE_DEFINITIONS[program.type].name;
  if (program.wcKind === 'male') return 'Moški WC';
  if (program.wcKind === 'female') return 'Ženski WC';
  return 'Unisex WC';
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
  if (order === 'zone-cluster') return clusterByZone(nonCorridors);
  return nonCorridors;
}

/** GMP načelo: prostore iste cone drži skupaj (stabilno znotraj cone, cone po ZONE_IDS). */
function clusterByZone(programs: RoomProgram[]): RoomProgram[] {
  const zoneOf = (program: RoomProgram): ZoneId => program.zone ?? zoneFromType(program.type);
  const order = new Map(ZONE_IDS.map((zone, index) => [zone, index]));
  return [...programs].sort((a, b) => (order.get(zoneOf(a)) ?? 99) - (order.get(zoneOf(b)) ?? 99));
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

function clamp(value: number, lo = 0, hi = 1): number {
  return Math.max(lo, Math.min(hi, value));
}

function roundToGrid(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}
