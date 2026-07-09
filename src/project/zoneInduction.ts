/**
 * Indukcija CON iz uvoženega načrta (IFC ali AI-ekstrakcija). Iz `NormalizedIfcPlan`
 * izpeljemo, katera cona (namembnost/čistost) pripada kateremu tipu prostora
 * (`zoneByType`) in koliko površine zaseda vsaka cona (`ZoneStat[]`). Te ugotovitve
 * nato tečejo naprej v projektni brief → generator (razvrščanje po conah) in v A/B
 * signal (kontiguiteta con). Če uvoz nosi eksplicitne cone (`NormalizedIfcRoom.zone`),
 * so te resnica; sicer se cona sklepa iz tipa prostora.
 */

import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import { zoneFromType, ZONE_IDS, type RoomType, type ZoneId } from './roomTypes';
import { zoneLabel } from './floorLayers';

export interface ZoneStat {
  zone: ZoneId;
  label: string;
  /** število prostorov v coni */
  rooms: number;
  /** delež programske površine (0..1) */
  areaShare: number;
}

export interface ZoneProfile {
  /** 'import' = cone so bile eksplicitno v uvozu; 'derived' = sklepane iz tipov */
  source: 'import' | 'derived';
  stats: ZoneStat[];
  /** naučena preslikava tip prostora → prevladujoča cona v uvozu */
  zoneByType: Partial<Record<RoomType, ZoneId>>;
  /** koliko različnih con nastopa (>1 → GMP ločevanje smiselno) */
  distinctZones: number;
}

/** Izpelji conski profil iz normaliziranega načrta (IFC ali AI-ekstrakcija). */
export function induceZoneProfile(plan: NormalizedIfcPlan): ZoneProfile {
  const roomAreas = new Map<ZoneId, number>();
  const roomCounts = new Map<ZoneId, number>();
  // za vsak tip: koliko prostorov je padlo v vsako cono (za prevladujočo cono)
  const typeZoneVotes = new Map<RoomType, Map<ZoneId, number>>();
  let hasExplicit = false;
  let totalArea = 0;

  for (const room of plan.rooms) {
    const explicit = typeof room.zone === 'string' && (ZONE_IDS as string[]).includes(room.zone) ? room.zone : undefined;
    if (explicit) hasExplicit = true;
    const zone = zoneFromType(room.roomType, explicit);
    const area = Math.max(0, room.w * room.d) / 1_000_000; // mm² → m²
    totalArea += area;
    roomAreas.set(zone, (roomAreas.get(zone) || 0) + area);
    roomCounts.set(zone, (roomCounts.get(zone) || 0) + 1);
    const votes = typeZoneVotes.get(room.roomType) || new Map<ZoneId, number>();
    votes.set(zone, (votes.get(zone) || 0) + 1);
    typeZoneVotes.set(room.roomType, votes);
  }

  const zoneByType: Partial<Record<RoomType, ZoneId>> = {};
  for (const [type, votes] of typeZoneVotes) {
    let best: ZoneId | undefined;
    let bestVotes = -1;
    for (const [zone, count] of votes) {
      if (count > bestVotes) {
        best = zone;
        bestVotes = count;
      }
    }
    if (best) zoneByType[type] = best;
  }

  const stats: ZoneStat[] = ZONE_IDS
    .filter((zone) => (roomCounts.get(zone) || 0) > 0)
    .map((zone) => ({
      zone,
      label: zoneLabel(zone),
      rooms: roomCounts.get(zone) || 0,
      areaShare: totalArea > 0 ? (roomAreas.get(zone) || 0) / totalArea : 0,
    }))
    .sort((a, b) => b.areaShare - a.areaShare);

  return {
    source: hasExplicit ? 'import' : 'derived',
    stats,
    zoneByType,
    distinctZones: stats.length,
  };
}

/** Kratek povzetek con za prikaz (npr. "Delo 62 % · Sanitarije 14 %"). */
export function zoneProfileSummary(profile: ZoneProfile): string {
  return profile.stats
    .map((stat) => `${stat.label} ${Math.round(stat.areaShare * 100)} %`)
    .join(' · ');
}
