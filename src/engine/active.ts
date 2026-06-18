import type { LayoutCandidate } from './generator';
import type { Channel } from './channels';
import type { RoomConfig } from '../constraints/brief';
import { measureChannel, scoreCandidateChannels } from './channels';

// Aktivno učenje — "Ugani kdo": namesto naključnega (ali zgolj najboljšega) A/B
// para izberi tistega, ki najbolj prepolovi negotovost. Vsaka izbira tako nese
// maksimum informacije → manj iteracij do umirjenih uteži.

export interface PairChoice {
  a: LayoutCandidate;
  b: LayoutCandidate;
  info: number; // koliko ta par razdvoji negotovost (informacijski donos)
  quality: number; // povprečna kvaliteta para (izkoriščanje)
}

// Negotovost kanala: kako malo vemo, kako uporabnik ceni ta kanal. Nizko zaupanje
// = visoka negotovost. Onemogočen kanal ne nosi negotovosti.
function channelUncertainty(channel: Channel): number {
  return channel.enabled ? Math.max(0, 1 - channel.confidence) : 0;
}

/**
 * Informacijski donos primerjave a vs b: vsota po kanalih
 *   negotovost(kanal) * |vrednost_a − vrednost_b|.
 * Velik, ko se par najmočneje razlikuje prav po kanalih, glede katerih smo
 * najbolj negotovi — to je vprašanje "moški ali ženska", ne tisto, ki odbije
 * enega kandidata.
 */
export function pairInformation(
  a: LayoutCandidate,
  b: LayoutCandidate,
  channels: Channel[],
  cfg: RoomConfig,
): number {
  return channels.reduce((sum, channel) => {
    const uncertainty = channelUncertainty(channel);
    if (uncertainty === 0) return sum;
    const diff = Math.abs(measureChannel(channel.id, a, cfg) - measureChannel(channel.id, b, cfg));
    return sum + uncertainty * diff;
  }, 0);
}

/**
 * Izbere naslednji A/B par.
 *
 * `explore` ∈ [0,1] je nastavljiv vzvod raziskovanje⇄izkoriščanje:
 *   1 = informativno (zgodaj, uči se hitro) — par z največjim razdvojem negotovosti;
 *   0 = najboljše (pozno, izkoristi naučeno) — par z najvišjo skupno kvaliteto.
 * Vmesne vrednosti mešajo oba signala (oba normirana na 0..1 čez vse pare).
 */
export function nextPair(
  pool: LayoutCandidate[],
  channels: Channel[],
  cfg: RoomConfig,
  explore = 0.7,
): PairChoice | null {
  if (pool.length < 2) return null;

  const quality = pool.map((candidate) => scoreCandidateChannels(candidate, channels, cfg).total);

  const pairs: { i: number; j: number; info: number; qual: number }[] = [];
  let maxInfo = 0;
  let maxQual = 0;
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i + 1; j < pool.length; j += 1) {
      const info = pairInformation(pool[i], pool[j], channels, cfg);
      const qual = (quality[i] + quality[j]) / 2;
      if (info > maxInfo) maxInfo = info;
      if (qual > maxQual) maxQual = qual;
      pairs.push({ i, j, info, qual });
    }
  }

  let best = pairs[0];
  let bestScore = -Infinity;
  for (const pair of pairs) {
    const infoNorm = maxInfo > 0 ? pair.info / maxInfo : 0;
    const qualNorm = maxQual > 0 ? pair.qual / maxQual : 0;
    const combined = explore * infoNorm + (1 - explore) * qualNorm;
    if (combined > bestScore) {
      bestScore = combined;
      best = pair;
    }
  }

  return { a: pool[best.i], b: pool[best.j], info: best.info, quality: best.qual };
}

/**
 * Predlagana stopnja raziskovanja glede na število že opravljenih primerjav:
 * informativno na začetku, postopno proti izkoriščanju. Mehek vzvod, ne fiksen —
 * UI ga lahko prepiše.
 */
export function suggestedExplore(comparisons: number, settleAt = 12): number {
  return Math.max(0, 1 - comparisons / settleAt);
}
