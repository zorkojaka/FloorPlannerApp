/**
 * Sintetični referenčni načrti — "resnica" za PoC. V produkciji te podatke
 * vrne AI-ekstrakcija iz naloženih načrtov (glej docs/EXTRACTION_PROMPT.md),
 * tu so ročno parametrizirani, da je zgodba ponovljiva.
 *
 * Vsi so klasični pisarniški trakt: vhod na kratki (W) stranici, hodnik
 * vzdolž stavbe, sobe obojestransko. Namerna variacija: širine hodnikov,
 * kvadrature, en WC daleč od vhoda (R4), enostranski trakt s tehničnim
 * jedrom (R5) — da indukcija pokaže varianco in mehka/trda pravila.
 */

import type { PlanRoom, ReferencePlan, RoomType } from './schema';

interface BarSlice {
  type: RoomType;
  w: number;
  /** globina od hodnika; če manjka, soba sega čez cel pas */
  depth?: number;
}

interface BarConfig {
  id: string;
  name: string;
  W: number;
  D: number;
  /** sredina hodnika (y); vhod na W steni na isti višini */
  cy: number;
  cw: number;
  top: BarSlice[];
  bottom: BarSlice[];
}

const ROOM_LABELS: Record<RoomType, string> = {
  office: 'Pisarna',
  wc: 'WC',
  corridor: 'Hodnik',
  storage: 'Shramba',
  tech: 'Tehnika',
  other: 'Prostor',
};

function barReference(cfg: BarConfig): ReferencePlan {
  const corridorId = `${cfg.id}-hodnik`;
  const corridorY = cfg.cy - cfg.cw / 2;
  const rooms: PlanRoom[] = [
    {
      id: corridorId,
      type: 'corridor',
      name: 'Hodnik',
      rect: { x: 0, y: corridorY, w: cfg.W, h: cfg.cw },
    },
  ];
  const counters: Partial<Record<RoomType, number>> = {};

  const addRoom = (type: RoomType, rect: PlanRoom['rect']) => {
    const n = (counters[type] = (counters[type] || 0) + 1);
    rooms.push({
      id: `${cfg.id}-${type}-${n}`,
      type,
      name: `${ROOM_LABELS[type]} ${n}`,
      rect,
    });
  };

  const layStrip = (slices: BarSlice[], side: 'top' | 'bottom') => {
    const stripH = side === 'top' ? corridorY : cfg.D - (corridorY + cfg.cw);
    let x = 0;
    for (const slice of slices) {
      const depth = Math.min(slice.depth ?? stripH, stripH);
      const y = side === 'top' ? corridorY - depth : corridorY + cfg.cw;
      addRoom(slice.type, { x, y, w: slice.w, h: depth });
      const back = stripH - depth;
      if (back >= 1500) {
        const backY = side === 'top' ? 0 : corridorY + cfg.cw + depth;
        addRoom('storage', { x, y: backY, w: slice.w, h: back });
      }
      x += slice.w;
    }
  };

  layStrip(cfg.top, 'top');
  layStrip(cfg.bottom, 'bottom');

  return {
    id: cfg.id,
    name: cfg.name,
    outline: { x: 0, y: 0, w: cfg.W, h: cfg.D },
    entrances: [{ side: 'W', offset: cfg.cy }],
    rooms,
    connections: rooms
      .filter((room) => room.id !== corridorId)
      .map((room) => ({ a: room.id, b: corridorId }))
      .concat([{ a: corridorId, b: 'outside' }]),
    layers: [{ id: 'arch', kind: 'architecture' }],
    flows: [{ id: 'ljudje', kind: 'people', path: [corridorId] }],
    source: 'synthetic',
  };
}

export function baseReferences(): ReferencePlan[] {
  return [
    barReference({
      id: 'R1',
      name: 'Referenca A — trakt 20×12',
      W: 20000,
      D: 12000,
      cy: 6000,
      cw: 1800,
      top: [
        { type: 'wc', w: 2000, depth: 2600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
      ],
      bottom: [
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
      ],
    }),
    barReference({
      id: 'R2',
      name: 'Referenca B — 24×11, ožji hodnik',
      W: 24000,
      D: 11000,
      cy: 5500,
      cw: 1650,
      top: [
        { type: 'wc', w: 2200, depth: 2400 },
        { type: 'office', w: 3400 },
        { type: 'office', w: 3400 },
        { type: 'office', w: 3400 },
        { type: 'office', w: 3800 },
        { type: 'office', w: 3800 },
        { type: 'office', w: 4000 },
      ],
      bottom: [
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
      ],
    }),
    barReference({
      id: 'R3',
      name: 'Referenca C — 16×12, kompakt, dva WC-ja',
      W: 16000,
      D: 12000,
      cy: 6300,
      cw: 2000,
      top: [
        { type: 'wc', w: 1800, depth: 3000 },
        { type: 'wc', w: 1800, depth: 3000 },
        { type: 'office', w: 3800 },
        { type: 'office', w: 4300 },
        { type: 'office', w: 4300 },
      ],
      bottom: [
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
      ],
    }),
    barReference({
      id: 'R4',
      name: 'Referenca D — 28×12, dolgi trakt, drugi WC v sredini',
      W: 28000,
      D: 12000,
      cy: 6000,
      cw: 2100,
      top: [
        { type: 'wc', w: 2200, depth: 2700 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 4200 },
      ],
      bottom: [
        { type: 'office', w: 3000 },
        { type: 'office', w: 3000 },
        { type: 'wc', w: 2300, depth: 2500 },
        { type: 'office', w: 3900 },
        { type: 'office', w: 3900 },
        { type: 'office', w: 3900 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
      ],
    }),
    barReference({
      id: 'R5',
      name: 'Referenca E — 18×10, enostransko + tehnično jedro',
      W: 18000,
      D: 10000,
      cy: 6100,
      cw: 1800,
      top: [
        { type: 'wc', w: 2100, depth: 2900 },
        { type: 'office', w: 3900 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
        { type: 'office', w: 4000 },
      ],
      bottom: [
        { type: 'storage', w: 6000 },
        { type: 'tech', w: 6000 },
        { type: 'storage', w: 6000 },
      ],
    }),
    barReference({
      id: 'R6',
      name: 'Referenca F — 22×13, širši hodnik',
      W: 22000,
      D: 13000,
      cy: 6500,
      cw: 2000,
      top: [
        { type: 'wc', w: 2200, depth: 2600 },
        { type: 'office', w: 3300 },
        { type: 'office', w: 3300 },
        { type: 'office', w: 3300 },
        { type: 'office', w: 3300 },
        { type: 'office', w: 3300 },
        { type: 'office', w: 3300 },
      ],
      bottom: [
        { type: 'office', w: 3700 },
        { type: 'office', w: 3700 },
        { type: 'office', w: 3700 },
        { type: 'office', w: 3700 },
        { type: 'office', w: 3600 },
        { type: 'office', w: 3600 },
      ],
    }),
  ];
}
