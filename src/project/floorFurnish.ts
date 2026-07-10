/**
 * Korak F na project liniji: opremi CELO etažo naenkrat. Vsak nehodniški prostor
 * izbranega tlorisa (FloorLayout) gre skozi engine opreme-v-sobi (Oreh 1). Preset
 * določa nabor opreme; vrata sedejo na steno proti hodniku. Rezultat je oprema v
 * svetovnih (metrskih) koordinatah etaže — pripravljena za izris čez FloorSvg.
 *
 * Enote: project dela v metrih, Oreh 1 v mm → sobo pretvorimo ×1000, postavljeno
 * opremo pa nazaj ÷1000 in zamaknemo za pozicijo sobe.
 */

import type { ProgramInstance, RoomConfig } from '../constraints/brief';
import type { PlacedElement } from '../engine/evaluator';
import { searchLayouts, type GenerateResult, type LayoutCandidate } from '../engine/generator';
import { rankByChannels } from '../engine/channels';
import type { Wall } from '../elements/model';
import { baseLib } from '../elements/library';
import type { FloorLayout, PlacedRoom } from './floorGenerator';
import type { RoomType } from './roomTypes';
import { channelsForType, type RoomTypePrefs } from './roomTypePreference';
import { applyInducedRules } from '../rules/induction';
import type { RoomRuleSets } from './referenceLibrary';

export interface FloorFurnItem {
  roomId: string;
  category: string;
  name: string;
  /** metri, svetovne koordinate etaže */
  x: number;
  y: number;
  w: number;
  h: number;
  kind?: 'door';
}

export type FloorFurnStatus = 'found' | 'not-found' | 'infeasible' | 'empty';

export interface RoomFurnResult {
  room: PlacedRoom;
  presetId: string;
  status: FloorFurnStatus;
  note?: string;
  items: FloorFurnItem[];
  fixtureCount: number;
}

export interface FloorFurnPreset {
  id: string;
  label: string;
  fixtures: (room: PlacedRoom) => string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const FLOOR_FURN_PRESETS: FloorFurnPreset[] = [
  {
    id: 'office',
    label: 'Pisarna (miza + stol + omara)',
    fixtures: (room) => {
      const seats = clamp(Math.round((room.w * room.d) / 7), 1, 3);
      const keys: string[] = [];
      for (let i = 0; i < seats; i += 1) keys.push('desk', 'chair');
      keys.push('cabinet');
      return keys;
    },
  },
  {
    id: 'wc',
    label: 'WC (školjka + umivalnik)',
    fixtures: (room) => {
      const keys = ['toilet'];
      if (room.wcKind === 'male' && room.w * room.d >= 3.5) keys.push('urinal');
      keys.push('sink');
      return keys;
    },
  },
  {
    id: 'storage',
    label: 'Skladišče (regali)',
    fixtures: (room) => Array(clamp(Math.floor((room.w * room.d) / 4), 1, 4)).fill('shelf'),
  },
  {
    id: 'empty',
    label: 'Prazno (samo vrata)',
    fixtures: () => [],
  },
];

export function findFloorPreset(id: string): FloorFurnPreset {
  return (
    FLOOR_FURN_PRESETS.find((preset) => preset.id === id) ??
    FLOOR_FURN_PRESETS[FLOOR_FURN_PRESETS.length - 1]
  );
}

export function defaultFloorPresetId(type: RoomType): string {
  switch (type) {
    case 'office':
      return 'office';
    case 'wc':
      return 'wc';
    default:
      return 'empty';
  }
}

/** Stran prostora (v metrih), ki meji na kateri koli hodnik → tja vrata. */
function corridorWall(room: PlacedRoom, corridors: PlacedRoom[]): Wall | 'auto' {
  const t = 0.2;
  for (const c of corridors) {
    const vOverlap = Math.min(room.y + room.d, c.y + c.d) - Math.max(room.y, c.y);
    const hOverlap = Math.min(room.x + room.w, c.x + c.w) - Math.max(room.x, c.x);
    if (Math.abs(room.x + room.w - c.x) < t && vOverlap > 0.4) return 'E';
    if (Math.abs(room.x - (c.x + c.w)) < t && vOverlap > 0.4) return 'W';
    if (Math.abs(room.y + room.d - c.y) < t && hOverlap > 0.4) return 'S';
    if (Math.abs(room.y - (c.y + c.d)) < t && hOverlap > 0.4) return 'N';
  }
  return 'auto';
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** placed (mm, lokalno) → FloorFurnItem (m, svetovno) */
function toFloorItems(room: PlacedRoom, placed: PlacedElement[]): FloorFurnItem[] {
  return placed.map((item) => ({
    roomId: room.id,
    category: item.kind === 'door' ? 'door' : item.el.category,
    name: item.kind === 'door' ? 'Vrata' : item.name,
    x: room.x + item.foot.x / 1000,
    y: room.y + item.foot.y / 1000,
    w: item.foot.w / 1000,
    h: item.foot.h / 1000,
    ...(item.kind === 'door' ? { kind: 'door' as const } : {}),
  }));
}

export interface FloorFurnishing {
  results: RoomFurnResult[];
  items: FloorFurnItem[];
}

/** Prepovedana cona v lokalnih (mm) koordinatah sobe. */
export interface RoomNoGoZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-soba popravek: preset, A/B seme (druga postavitev) in prepovedane cone. */
export interface RoomOverride {
  presetId?: string;
  /** izbira A/B različice postavitve pohištva (spremeni seme generatorja) */
  seed?: number;
  /** prepovedane cone (lokalno, mm) — engine se jim izogne */
  zones?: RoomNoGoZone[];
}

export type RoomChoice = string | RoomOverride;

/** Iskalna specifikacija sobe: program, konfiguracija in deterministično seme. */
export interface RoomSearchSpec {
  program: ProgramInstance[];
  cfg: RoomConfig;
  seed: number;
  presetId: string;
  fixtureKeys: string[];
  zones?: RoomNoGoZone[];
}

export function roomSearchSpec(layout: FloorLayout, room: PlacedRoom, override: RoomOverride = {}): RoomSearchSpec {
  const corridors = [layout.corridor, ...(layout.corridorLinks || [])].filter(Boolean);
  const index = Math.max(0, layout.rooms.findIndex((r) => r.id === room.id));
  const presetId = override.presetId ?? defaultFloorPresetId(room.type);
  const fixtureKeys = findFloorPreset(presetId).fixtures(room);

  const doorSide = room.doorSide ?? corridorWall(room, corridors);
  const wallLenM =
    doorSide === 'N' || doorSide === 'S'
      ? room.w
      : doorSide === 'E' || doorSide === 'W'
        ? room.d
        : Math.max(room.w, room.d);
  const doorW = clamp(Math.min(900, wallLenM * 1000 - 300), 600, 900);

  return {
    program: [
      { id: `${room.id}-door`, key: 'door', w: doorW, dir: 'inward', wall: doorSide, hinge: 'auto' },
      ...fixtureKeys.map((key, i) => ({ id: `${room.id}-fx${i}`, key })),
    ],
    cfg: { W: Math.round(room.w * 1000), D: Math.round(room.d * 1000), wetWall: 'S', minAisle: 700 },
    seed: 9973 * (index + 1) + Math.round(room.w * 1000) + (override.seed || 0) * 7919,
    presetId,
    fixtureKeys,
    zones: override.zones,
  };
}

/** Bazen kandidatov postavitve za eno sobo — vhod za A/B aktivno učenje (Korak 3). */
export function roomCandidatePool(
  layout: FloorLayout,
  room: PlacedRoom,
  override: RoomOverride = {},
  samples = 240,
  ruleSets?: RoomRuleSets,
): { res: GenerateResult; spec: RoomSearchSpec } {
  const spec = roomSearchSpec(layout, room, override);
  // inducirana pravila tipa sobe (iz referenc) prepišejo privzete envelope — pravila so podatki
  const rules = ruleSets?.[room.type];
  const res = searchLayouts({
    library: rules?.length ? applyInducedRules(baseLib(), rules) : baseLib(),
    program: spec.program,
    cfg: spec.cfg,
    soft: true,
    minPathWidth: 550,
    samples,
    zones: spec.zones,
    random: mulberry32(spec.seed),
  });
  return { res, spec };
}

/** Kandidat sobe → oprema v svetovnih koordinatah etaže (za izris para v UI). */
export function roomCandidateItems(room: PlacedRoom, candidate: LayoutCandidate): FloorFurnItem[] {
  return toFloorItems(room, candidate.placed);
}

export function furnishFloorLayout(
  layout: FloorLayout,
  choices: Record<string, RoomChoice>,
  prefs?: RoomTypePrefs,
  ruleSets?: RoomRuleSets,
): FloorFurnishing {
  const results: RoomFurnResult[] = [];

  layout.rooms.forEach((room) => {
    if (room.type === 'corridor') return;

    const raw = choices[room.id];
    const override: RoomOverride = typeof raw === 'string' ? { presetId: raw } : raw || {};
    const { res, spec } = roomCandidatePool(layout, room, override, 240, ruleSets);
    const { presetId, fixtureKeys, cfg } = spec;

    // naučene preference tipa sobe rangirajo bazen — izbire v eni pisarni izboljšajo vse pisarne
    const channels = prefs ? channelsForType(prefs, room.type) : null;
    const best = channels && res.candidates.length > 1 ? rankByChannels(res.candidates, channels, cfg)[0] : res.candidates[0];
    if (best) {
      results.push({
        room,
        presetId,
        status: fixtureKeys.length === 0 ? 'empty' : 'found',
        items: toFloorItems(room, best.placed),
        fixtureCount: fixtureKeys.length,
      });
    } else {
      results.push({
        room,
        presetId,
        status: res.status === 'infeasible' ? 'infeasible' : 'not-found',
        note: res.status === 'infeasible' ? res.reasons[0] || 'trdo neizvedljivo' : 'iskanje ni našlo postavitve',
        items: [],
        fixtureCount: fixtureKeys.length,
      });
    }
  });

  return { results, items: results.flatMap((r) => r.items) };
}
