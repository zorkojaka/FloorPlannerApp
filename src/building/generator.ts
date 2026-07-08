/**
 * Generator stavbe — isti princip kot generator opreme-v-sobi, samo enota je
 * soba in prostor je stavba. Deterministično (seeded RNG), brez AI:
 * hodnik kot hrbtenica od vhoda, sobe obojestransko, WC blizu vhoda,
 * pregloboki pasovi dobijo zaledno cono (shramba/tehnika).
 *
 * Kandidat je kar ReferencePlan — ista struktura kot referenca, zato ga
 * riše isti izrisovalnik in lahko izbrani kandidat kasneje postane nova
 * referenca (zanka učenja).
 */

import { findMetric, type BuildingRuleset } from './induction';
import type { PlanEntrance, PlanRoom, Rect, ReferencePlan, RoomType } from './schema';

export interface BuildingBrief {
  /** mm */
  W: number;
  /** mm */
  D: number;
  entrance: PlanEntrance;
  offices: number;
  wcs: number;
}

export interface GenerationOutput {
  plans: ReferencePlan[];
  /** trda neizvedljivost — naloga se matematično ne izide */
  infeasible?: string;
  /** mehki neuspeh — poskusi niso našli postavitve (ni isto kot neizvedljivo) */
  searchNote?: string;
}

interface LocalSlice {
  type: RoomType;
  w: number;
  depth: number;
}

const MIN_STRIP_DEPTH = 2200;

export function generateBuildingCandidates(
  brief: BuildingBrief,
  ruleset: BuildingRuleset,
  count = 10,
  seedBase = 1,
): GenerationOutput {
  const infeasible = checkBriefFeasibility(brief, ruleset);
  if (infeasible) return { plans: [], infeasible };

  const plans: ReferencePlan[] = [];
  const reasons = new Set<string>();
  let attempt = 0;
  while (plans.length < count && attempt < count * 6) {
    attempt += 1;
    const rng = mulberry32(seedBase * 7919 + attempt * 104729);
    const result = buildCandidate(brief, ruleset, rng, `K${plans.length + 1}`, attempt);
    if (typeof result === 'string') {
      reasons.add(result);
      continue;
    }
    if (plans.some((plan) => samePlan(plan, result))) continue;
    plans.push(result);
  }

  if (plans.length === 0) {
    return {
      plans: [],
      searchNote: `Nisem našel postavitve (${count * 6} poskusov). Razlogi: ${[...reasons].join(' · ') || 'neznano'}. To ni dokaz neizvedljivosti — poskusi z drugim semenom ali omili nalogo.`,
    };
  }
  return { plans };
}

export function checkBriefFeasibility(brief: BuildingBrief, ruleset: BuildingRuleset): string | undefined {
  const officeArea = findMetric(ruleset, 'office-area');
  const wcArea = findMetric(ruleset, 'wc-area');
  const corridorW = findMetric(ruleset, 'corridor-width');
  if (!officeArea || !wcArea || !corridorW) {
    return 'Pravila niso inducirana — najprej naloži reference.';
  }
  const horizontal = brief.entrance.side === 'W' || brief.entrance.side === 'E';
  const U = horizontal ? brief.W : brief.D;
  const V = horizontal ? brief.D : brief.W;
  if (brief.entrance.offset <= 0 || brief.entrance.offset >= V) {
    return `Vhod (odmik ${brief.entrance.offset} mm) leži izven stene (0–${V} mm).`;
  }
  const needed =
    brief.offices * officeArea.envelope.core * 1_000_000 +
    brief.wcs * wcArea.envelope.core * 1_000_000 +
    corridorW.envelope.core * U;
  const available = brief.W * brief.D;
  if (needed > available) {
    const neededM2 = (needed / 1_000_000).toFixed(1);
    const availableM2 = (available / 1_000_000).toFixed(1);
    return `Neizvedljivo: trda jedra zahtevajo ≥ ${neededM2} m², stavba ima ${availableM2} m². Zmanjšaj število sob ali povečaj stavbo.`;
  }
  return undefined;
}

function buildCandidate(
  brief: BuildingBrief,
  ruleset: BuildingRuleset,
  rng: () => number,
  id: string,
  seed: number,
): ReferencePlan | string {
  const corridorRule = findMetric(ruleset, 'corridor-width')!;
  const officeArea = findMetric(ruleset, 'office-area')!;
  const officeDepth = findMetric(ruleset, 'office-depth');
  const wcArea = findMetric(ruleset, 'wc-area')!;

  const horizontal = brief.entrance.side === 'W' || brief.entrance.side === 'E';
  const U = horizontal ? brief.W : brief.D;
  const V = horizontal ? brief.D : brief.W;

  const cw = roundTo(
    Math.max(corridorRule.envelope.core, lerp(corridorRule.envelope.halo, corridorRule.envelope.sat, rng())),
    50,
  );

  // pozicija hodnika: mora zajeti vhod; variante = centriran na vhod ali ob steni
  const vc = brief.entrance.offset;
  const cTopOptions = [clamp(vc - cw / 2, 0, V - cw)];
  if (vc <= cw) cTopOptions.push(0);
  if (vc >= V - cw) cTopOptions.push(V - cw);
  let cTop = cTopOptions[Math.floor(rng() * cTopOptions.length)];

  // pregrobo tanek pas → prisloni hodnik na steno, če vhod to dopušča
  const near = cTop;
  const far = V - cTop - cw;
  if (near > 0 && near < MIN_STRIP_DEPTH && vc <= cw) cTop = 0;
  if (far > 0 && far < MIN_STRIP_DEPTH && vc >= V - cw) cTop = V - cw;

  const strips: Array<{ side: 'near' | 'far'; depth: number }> = [
    { side: 'near' as const, depth: cTop },
    { side: 'far' as const, depth: V - cTop - cw },
  ].filter((strip) => strip.depth >= MIN_STRIP_DEPTH);

  if (strips.length === 0) return 'hodnik ne pusti nobenega uporabnega pasu sob';

  const depthHalo = officeDepth?.envelope.halo ?? 5000;
  const depthSat = officeDepth?.envelope.sat ?? 5600;

  interface StripPlan {
    side: 'near' | 'far';
    depth: number;
    roomDepth: number;
    backDepth: number;
    slices: LocalSlice[];
  }

  const stripPlans: StripPlan[] = strips.map((strip) => {
    const roomDepth = strip.depth > depthSat + 1500 ? roundTo(depthHalo, 50) : strip.depth;
    return {
      side: strip.side,
      depth: strip.depth,
      roomDepth,
      backDepth: strip.depth - roomDepth,
      slices: [],
    };
  });

  // WC-ji: privzeto ob vhodu, občasno globlje v traktu (evaluator to kaznuje)
  let wcsLeft = brief.wcs;
  const wcSlices: Array<{ strip: StripPlan; nearEntrance: boolean; slice: LocalSlice }> = [];
  while (wcsLeft > 0) {
    const strip = stripPlans[Math.floor(rng() * stripPlans.length)];
    const wcW = roundTo(1800 + rng() * 600, 50);
    const wcDepth = clamp(
      roundTo((wcArea.envelope.halo * 1_000_000) / wcW, 50),
      2200,
      strip.roomDepth,
    );
    wcSlices.push({
      strip,
      nearEntrance: rng() < 0.72,
      slice: { type: 'wc', w: wcW, depth: wcDepth },
    });
    wcsLeft -= 1;
  }

  // pisarne: razdeli po pasovih sorazmerno z razpoložljivo dolžino
  const wcWidthPerStrip = new Map<StripPlan, number>();
  for (const wc of wcSlices) {
    wcWidthPerStrip.set(wc.strip, (wcWidthPerStrip.get(wc.strip) || 0) + wc.slice.w);
  }
  const freeLength = (strip: StripPlan) => U - (wcWidthPerStrip.get(strip) || 0);
  const totalFree = stripPlans.reduce((sum, strip) => sum + freeLength(strip), 0);

  const officeCounts = new Map<StripPlan, number>();
  let assigned = 0;
  stripPlans.forEach((strip, index) => {
    const share =
      index === stripPlans.length - 1
        ? brief.offices - assigned
        : Math.round((brief.offices * freeLength(strip)) / totalFree);
    officeCounts.set(strip, share);
    assigned += share;
  });

  for (const strip of stripPlans) {
    const nOffices = officeCounts.get(strip) || 0;
    const wcsHere = wcSlices.filter((wc) => wc.strip === strip);
    const available = freeLength(strip);

    const targetW = (officeArea.envelope.halo * 1_000_000) / strip.roomDepth;
    const minW = Math.max(2400, (officeArea.envelope.core * 1_000_000) / strip.roomDepth);
    if (nOffices > 0 && nOffices * minW > available) {
      return `pas ${strip.side} ne sprejme ${nOffices} pisarn (trdo jedro kvadrature)`;
    }

    let widths = Array.from({ length: nOffices }, () =>
      roundTo(targetW * (0.92 + rng() * 0.16), 50),
    );
    const sum = widths.reduce((total, w) => total + w, 0);
    if (sum > available) {
      const scale = available / sum;
      widths = widths.map((w) => Math.max(minW, roundTo(w * scale, 50)));
      if (widths.reduce((total, w) => total + w, 0) > available) {
        return `pas ${strip.side} ne sprejme ${nOffices} pisarn (trdo jedro kvadrature)`;
      }
    }

    // sestavi rezine: WC ob vhodu → pisarne → (WC globlje) → ostanek
    const slices: LocalSlice[] = [];
    for (const wc of wcsHere.filter((wc) => wc.nearEntrance)) slices.push(wc.slice);
    const deepWcs = wcsHere.filter((wc) => !wc.nearEntrance);
    widths.forEach((w, index) => {
      slices.push({ type: 'office', w, depth: strip.roomDepth });
      if (index === Math.floor(widths.length / 2) && deepWcs.length > 0) {
        slices.push(deepWcs.shift()!.slice);
      }
    });
    for (const leftover of deepWcs) slices.push(leftover.slice);

    const used = slices.reduce((total, slice) => total + slice.w, 0);
    const leftover = U - used;
    if (leftover < -1) return `pas ${strip.side} prekoračen za ${-leftover} mm`;
    if (leftover > 0 && leftover < 1200 && widths.length > 0) {
      // raztegni pisarne, da pas zapolnimo
      const bonus = roundTo(leftover / widths.length, 10);
      let granted = 0;
      for (const slice of slices) {
        if (slice.type !== 'office') continue;
        slice.w += bonus;
        granted += bonus;
      }
      const last = [...slices].reverse().find((slice) => slice.type === 'office');
      if (last) last.w += leftover - granted;
    } else if (leftover >= 1200) {
      slices.push({ type: 'storage', w: leftover, depth: strip.roomDepth });
    }

    strip.slices = slices;
  }

  // v svet: lokalno (u vzdolž hodnika, v prečno) → world glede na stran vhoda
  const rooms: PlanRoom[] = [];
  const counters: Partial<Record<RoomType, number>> = {};
  const labels: Record<RoomType, string> = {
    office: 'Pisarna',
    wc: 'WC',
    corridor: 'Hodnik',
    storage: 'Shramba',
    tech: 'Tehnika',
    other: 'Prostor',
  };
  const addRoom = (type: RoomType, local: { u: number; v: number; du: number; dv: number }) => {
    const n = (counters[type] = (counters[type] || 0) + 1);
    rooms.push({
      id: `${id}-${type}-${n}`,
      type,
      name: `${labels[type]} ${n}`,
      rect: toWorld(local, brief),
    });
  };

  addRoom('corridor', { u: 0, v: cTop, du: U, dv: cw });

  for (const strip of stripPlans) {
    let u = 0;
    for (const slice of strip.slices) {
      const v =
        strip.side === 'near' ? cTop - slice.depth : cTop + cw;
      addRoom(slice.type, { u, v, du: slice.w, dv: slice.depth });
      const back = strip.depth - slice.depth;
      if (back >= 1500) {
        const backV = strip.side === 'near' ? cTop - strip.depth : cTop + cw + slice.depth;
        addRoom(back > 3500 && slice.type === 'office' ? 'tech' : 'storage', {
          u,
          v: backV,
          du: slice.w,
          dv: back,
        });
      }
      u += slice.w;
    }
  }

  const corridorId = rooms[0].id;
  return {
    id,
    name: `Kandidat ${id} (seme ${seed})`,
    outline: { x: 0, y: 0, w: brief.W, h: brief.D },
    entrances: [brief.entrance],
    rooms,
    connections: rooms
      .filter((room) => room.id !== corridorId)
      .map((room) => ({ a: room.id, b: corridorId }))
      .concat([{ a: corridorId, b: 'outside' as const }]),
    layers: [{ id: 'arch', kind: 'architecture' as const }],
    flows: [{ id: 'ljudje', kind: 'people' as const, path: [corridorId] }],
    source: 'synthetic',
  };
}

function toWorld(
  local: { u: number; v: number; du: number; dv: number },
  brief: BuildingBrief,
): Rect {
  switch (brief.entrance.side) {
    case 'W':
      return { x: local.u, y: local.v, w: local.du, h: local.dv };
    case 'E':
      return { x: brief.W - local.u - local.du, y: local.v, w: local.du, h: local.dv };
    case 'N':
      return { x: local.v, y: local.u, w: local.dv, h: local.du };
    case 'S':
      return { x: local.v, y: brief.D - local.u - local.du, w: local.dv, h: local.du };
  }
}

function samePlan(a: ReferencePlan, b: ReferencePlan): boolean {
  if (a.rooms.length !== b.rooms.length) return false;
  return a.rooms.every((room, index) => {
    const other = b.rooms[index];
    return (
      room.type === other.type &&
      Math.abs(room.rect.x - other.rect.x) < 100 &&
      Math.abs(room.rect.y - other.rect.y) < 100 &&
      Math.abs(room.rect.w - other.rect.w) < 100 &&
      Math.abs(room.rect.h - other.rect.h) < 100
    );
  });
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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
