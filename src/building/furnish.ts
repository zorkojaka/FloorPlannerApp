/**
 * Gnezdenje Oreh 1 v Oreh 2: vsak prostor etaže spustimo skozi engine
 * opreme-v-sobi. Preset določa, KATERI engine (nabor opreme) postavlja v prostor
 * — WC, pisarna, skladišče … Vsak prostor lahko dobi svoj preset (izbira
 * uporabnika). Rezultat je cela etaža: sobe + hodniki + oprema, v svetovnih
 * koordinatah stavbe.
 */

import type { ProgramInstance } from '../constraints/brief';
import type { PlacedElement } from '../engine/evaluator';
import { searchLayouts } from '../engine/generator';
import type { Wall } from '../elements/model';
import { baseLib } from '../elements/library';
import { uid } from '../shared/math';
import type { PlanRoom, Rect, ReferencePlan, RoomType } from './schema';

/** Element opreme, postavljen v svetovne (stavbne) koordinate — za izris. */
export interface FloorItem {
  roomId: string;
  category: string;
  name: string;
  rect: Rect;
  kind?: 'door';
  swing?: Rect | null;
  dir?: 'inward' | 'outward';
}

export type FurnishStatus = 'found' | 'not-found' | 'infeasible' | 'empty';

export interface RoomFurnishing {
  room: PlanRoom;
  presetId: string;
  status: FurnishStatus;
  note?: string;
  items: FloorItem[];
  fixtureCount: number;
}

export interface FurnishPreset {
  id: string;
  label: string;
  /** kateri tip prostora ta preset privzeto pokriva (za samodejno izbiro) */
  fixtures: (room: PlanRoom) => string[];
}

function areaM2(rect: Rect): number {
  return (rect.w * rect.h) / 1_000_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Registri presetov — nabor opreme, ki ga engine postavi v prostor. */
export const FURNISH_PRESETS: FurnishPreset[] = [
  {
    id: 'office',
    label: 'Pisarna (mize + omara)',
    fixtures: (room) => {
      const a = areaM2(room.rect);
      const desks = clamp(Math.round(a / 7), 1, 3);
      const cabinets = a >= 6 ? 1 : 0;
      return [...Array(desks).fill('desk'), ...Array(cabinets).fill('cabinet')];
    },
  },
  {
    id: 'wc',
    label: 'WC (školjka + umivalnik)',
    fixtures: (room) => {
      const keys = ['toilet', 'sink'];
      if (areaM2(room.rect) >= 4.5) keys.push('urinal');
      return keys;
    },
  },
  {
    id: 'storage',
    label: 'Skladišče (regali)',
    fixtures: (room) => Array(clamp(Math.floor(areaM2(room.rect) / 4), 1, 4)).fill('shelf'),
  },
  {
    id: 'empty',
    label: 'Prazno (samo vrata)',
    fixtures: () => [],
  },
];

export function findPreset(id: string): FurnishPreset {
  return FURNISH_PRESETS.find((preset) => preset.id === id) ?? FURNISH_PRESETS[FURNISH_PRESETS.length - 1];
}

/** Privzeti preset glede na tip prostora, ki ga je določil generator stavbe. */
export function defaultPresetId(type: RoomType): string {
  switch (type) {
    case 'office':
      return 'office';
    case 'wc':
      return 'wc';
    case 'storage':
    case 'tech':
      return 'storage';
    default:
      return 'empty';
  }
}

/** Stran prostora, ki meji na hodnik — tja gredo vrata (odpiranje navznoter). */
function corridorWall(room: Rect, corridor: Rect | undefined): Wall | 'auto' {
  if (!corridor) return 'auto';
  const t = 80;
  const vOverlap = Math.min(room.y + room.h, corridor.y + corridor.h) - Math.max(room.y, corridor.y);
  const hOverlap = Math.min(room.x + room.w, corridor.x + corridor.w) - Math.max(room.x, corridor.x);
  if (Math.abs(room.x + room.w - corridor.x) < t && vOverlap > 300) return 'E';
  if (Math.abs(room.x - (corridor.x + corridor.w)) < t && vOverlap > 300) return 'W';
  if (Math.abs(room.y + room.h - corridor.y) < t && hOverlap > 300) return 'S';
  if (Math.abs(room.y - (corridor.y + corridor.h)) < t && hOverlap > 300) return 'N';
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

function toWorldItems(room: PlanRoom, placed: PlacedElement[]): FloorItem[] {
  const ox = room.rect.x;
  const oy = room.rect.y;
  const shift = (r: Rect): Rect => ({ x: ox + r.x, y: oy + r.y, w: r.w, h: r.h });
  return placed.map((item) => {
    if (item.kind === 'door') {
      return {
        roomId: room.id,
        category: 'door',
        name: 'Vrata',
        rect: shift(item.foot),
        kind: 'door' as const,
        swing: item.swing ? shift(item.swing) : null,
        dir: item.dir,
      };
    }
    return {
      roomId: room.id,
      category: item.el.category,
      name: item.name,
      rect: shift(item.foot),
    };
  });
}

/**
 * Opremi celo etažo: za vsak nehodniški prostor poženi engine (Oreh 1) z izbranim
 * presetom. Vrata sedejo na steno proti hodniku. Deterministično (seme na prostor).
 */
export function furnishFloor(
  plan: ReferencePlan,
  choices: Record<string, string>,
): RoomFurnishing[] {
  const library = baseLib();
  const corridor = plan.rooms.find((room) => room.type === 'corridor');
  const out: RoomFurnishing[] = [];

  plan.rooms.forEach((room, index) => {
    if (room.type === 'corridor') return;

    const presetId = choices[room.id] ?? defaultPresetId(room.type);
    const preset = findPreset(presetId);
    const fixtureKeys = preset.fixtures(room);

    const doorSide = corridorWall(room.rect, corridor?.rect);
    const wallLen =
      doorSide === 'N' || doorSide === 'S'
        ? room.rect.w
        : doorSide === 'E' || doorSide === 'W'
          ? room.rect.h
          : Math.max(room.rect.w, room.rect.h);
    const doorW = clamp(Math.min(900, wallLen - 300), 600, 900);

    const program: ProgramInstance[] = [
      { id: uid(), key: 'door', w: doorW, dir: 'inward', wall: doorSide, hinge: 'auto' },
      ...fixtureKeys.map((key) => ({ id: uid(), key })),
    ];

    const res = searchLayouts({
      library,
      program,
      cfg: { W: room.rect.w, D: room.rect.h, wetWall: 'S', minAisle: 700 },
      soft: true,
      minPathWidth: 550,
      samples: 240,
      random: mulberry32(9973 * (index + 1) + room.rect.w),
    });

    const best = res.candidates[0];
    if (best) {
      out.push({
        room,
        presetId,
        status: fixtureKeys.length === 0 ? 'empty' : 'found',
        items: toWorldItems(room, best.placed),
        fixtureCount: fixtureKeys.length,
      });
    } else {
      out.push({
        room,
        presetId,
        status: res.status === 'infeasible' ? 'infeasible' : 'not-found',
        note:
          res.status === 'infeasible'
            ? res.reasons[0] || 'trdo neizvedljivo'
            : 'iskanje ni našlo veljavne postavitve',
        items: [],
        fixtureCount: fixtureKeys.length,
      });
    }
  });

  return out;
}
