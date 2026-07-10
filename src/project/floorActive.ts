import type { FloorLayout } from './floorGenerator';
import {
  FLOOR_SIGNAL_KEYS,
  floorSignals,
  normalizeFloorPreferenceState,
  scoreFloorLayout,
  type FloorPreferenceState,
} from './floorPreference';

// Aktivno učenje na nivoju ETAŽE — isti princip kot engine/active.ts za sobo:
// namesto "prvak proti naslednjemu po rangu" (podobna kandidata, malo informacije)
// izberi par, ki se najmočneje razlikuje po signalih, glede katerih smo najbolj
// negotovi. Uporabnik tako najprej odloča med RAZNOLIKIMI opcijami, šele proti
// koncu med podobnimi dobrimi.

export interface FloorPairChoice {
  a: FloorLayout;
  b: FloorLayout;
  /** koliko ta par razdvoji negotovost (informacijski donos) */
  info: number;
  /** povprečna kvaliteta para po trenutnih utežeh (izkoriščanje) */
  quality: number;
}

/** Informacijski donos para: vsota po signalih negotovost × |razlika signala|. */
export function floorPairInformation(a: FloorLayout, b: FloorLayout, state: FloorPreferenceState): number {
  const s = normalizeFloorPreferenceState(state);
  const sa = floorSignals(a);
  const sb = floorSignals(b);
  return FLOOR_SIGNAL_KEYS.reduce((sum, key) => sum + (1 - s.confidence[key]) * Math.abs(sa[key] - sb[key]), 0);
}

/**
 * Rangiran seznam A/B parov: explore=1 → največji informacijski donos (raznoliki
 * pari, hitro učenje), explore=0 → najvišja skupna kvaliteta (fina izbira med
 * dobrimi). Vrne do `limit` najboljših parov, da "naslednji par" kroži po smiselnih.
 */
export function nextFloorPairs(
  candidates: FloorLayout[],
  state: FloorPreferenceState,
  explore = 0.7,
  limit = 12,
): FloorPairChoice[] {
  // uporabnika ne sprašuj proti pokvarjenim kandidatom: veljavni (brez opozoril)
  // imajo prednost, celoten bazen je le rezerva za premajhne bazene
  const valid = candidates.filter((layout) => layout.warnings.length === 0);
  const pool = valid.length >= 2 ? valid : candidates;
  if (pool.length < 2) return [];
  const s = normalizeFloorPreferenceState(state);
  const signals = pool.map((layout) => floorSignals(layout));
  const quality = pool.map((layout) => scoreFloorLayout(layout, s.weights));
  const uncertainty = FLOOR_SIGNAL_KEYS.map((key) => 1 - s.confidence[key]);

  const pairs: Array<{ i: number; j: number; info: number; qual: number }> = [];
  let maxInfo = 0;
  let maxQual = 0;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      let info = 0;
      FLOOR_SIGNAL_KEYS.forEach((key, k) => {
        if (uncertainty[k] === 0) return;
        info += uncertainty[k] * Math.abs(signals[i][key] - signals[j][key]);
      });
      const qual = (quality[i] + quality[j]) / 2;
      if (info > maxInfo) maxInfo = info;
      if (qual > maxQual) maxQual = qual;
      pairs.push({ i, j, info, qual });
    }
  }

  const scored = pairs.map((pair) => ({
    pair,
    combined:
      explore * (maxInfo > 0 ? pair.info / maxInfo : 0) +
      (1 - explore) * (maxQual > 0 ? pair.qual / maxQual : 0),
  }));
  scored.sort((a, b) => b.combined - a.combined);
  return scored.slice(0, limit).map(({ pair }) => ({
    a: pool[pair.i],
    b: pool[pair.j],
    info: pair.info,
    quality: pair.qual,
  }));
}

/** Predlagano raziskovanje: informativno na začetku, proti izkoriščanju s primerjavami. */
export function suggestedFloorExplore(comparisons: number, settleAt = 10): number {
  return Math.max(0, 1 - comparisons / settleAt);
}

/** Strukturna družina tlorisa: orientacija hodnika × število vzporednih hodnikov. */
export function structuralKey(layout: FloorLayout): string {
  const horizontal = layout.corridor.w >= layout.corridor.d;
  const mains = 1 + layout.corridorLinks.filter((c) => c.id.startsWith('corridor-main')).length;
  return `${horizontal ? 'vodoraven' : 'navpičen'}-${mains}h`;
}

/** Družine v bazenu: koliko strukturno različnih tipov tlorisov ponujamo. */
export function structuralFamilies(pool: FloorLayout[]): Map<string, number> {
  const families = new Map<string, number>();
  for (const layout of pool) {
    const key = structuralKey(layout);
    families.set(key, (families.get(key) || 0) + 1);
  }
  return families;
}

/**
 * Mera raznolikosti bazena (0..1): povprečna parna razdalja vektorjev signalov,
 * normirana z največjo možno razdaljo. 0 = vsi kandidati enaki, večje = bolj raznolik bazen.
 */
export function poolDiversity(pool: FloorLayout[]): number {
  if (pool.length < 2) return 0;
  const signals = pool.map((layout) => floorSignals(layout));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < signals.length; i += 1) {
    for (let j = i + 1; j < signals.length; j += 1) {
      let d = 0;
      for (const key of FLOOR_SIGNAL_KEYS) d += (signals[i][key] - signals[j][key]) ** 2;
      sum += Math.sqrt(d);
      count += 1;
    }
  }
  return sum / count / Math.sqrt(FLOOR_SIGNAL_KEYS.length);
}
