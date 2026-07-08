/**
 * Evaluator kandidata stavbe: trde kontrole (nikoli kršene) + mehke kazni
 * po induciranih pravilih. Vsaka ocena je razložljiva — seznam kontrol s
 * statusom in besedilom, ne črna škatla.
 */

import { findMetric, type BuildingRuleset, type MetricRule } from './induction';
import type { BuildingBrief } from './generator';
import {
  entrancePoint,
  rectCenter,
  rectsOverlap,
  rectsTouch,
  roomArea,
  toM2,
  type ReferencePlan,
} from './schema';

export interface SoftPenalties {
  /** odstopanje kvadratur od halo */
  area: number;
  /** oddaljenost WC od vhoda */
  wcDist: number;
  /** delež hodnika (izkoristek tlorisa) */
  corridor: number;
  /** pisarne brez fasade (dnevna svetloba) */
  facade: number;
}

export type PenaltyKey = keyof SoftPenalties;

export interface CandidateCheck {
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface BuildingCandidate {
  id: string;
  plan: ReferencePlan;
  hardOk: boolean;
  hardFails: string[];
  penalties: SoftPenalties;
  checks: CandidateCheck[];
}

export function evaluateBuildingCandidate(
  plan: ReferencePlan,
  brief: BuildingBrief,
  ruleset: BuildingRuleset,
): BuildingCandidate {
  const hardFails: string[] = [];
  const checks: CandidateCheck[] = [];

  const corridors = plan.rooms.filter((room) => room.type === 'corridor');
  const offices = plan.rooms.filter((room) => room.type === 'office');
  const wcs = plan.rooms.filter((room) => room.type === 'wc');
  const entrance = entrancePoint(plan.outline, plan.entrances[0]);

  // ── trde kontrole ──────────────────────────────────────────────
  if (offices.length !== brief.offices)
    hardFails.push(`Število pisarn ${offices.length} ≠ naloga ${brief.offices}.`);
  if (wcs.length !== brief.wcs) hardFails.push(`Število WC ${wcs.length} ≠ naloga ${brief.wcs}.`);

  for (const room of plan.rooms) {
    const r = room.rect;
    const o = plan.outline;
    if (r.x < o.x - 1 || r.y < o.y - 1 || r.x + r.w > o.x + o.w + 1 || r.y + r.h > o.y + o.h + 1) {
      hardFails.push(`${room.name} sega izven stavbe.`);
    }
  }
  for (let i = 0; i < plan.rooms.length; i += 1) {
    for (let j = i + 1; j < plan.rooms.length; j += 1) {
      if (rectsOverlap(plan.rooms[i].rect, plan.rooms[j].rect, 5)) {
        hardFails.push(`${plan.rooms[i].name} in ${plan.rooms[j].name} se prekrivata.`);
      }
    }
  }
  for (const room of [...offices, ...wcs]) {
    if (!corridors.some((corridor) => rectsTouch(corridor.rect, room.rect))) {
      hardFails.push(`${room.name} nima dostopa s hodnika.`);
    }
  }

  const corridorRule = findMetric(ruleset, 'corridor-width');
  if (corridorRule) {
    for (const corridor of corridors) {
      const width = Math.min(corridor.rect.w, corridor.rect.h);
      if (width < corridorRule.envelope.core - 1) {
        hardFails.push(`Hodnik ${width} mm < trdo jedro ${corridorRule.envelope.core} mm.`);
      } else {
        checks.push({
          label: 'Širina hodnika',
          status: width >= corridorRule.envelope.halo ? 'ok' : 'warn',
          detail: `${Math.round(width)} mm (jedro ${Math.round(corridorRule.envelope.core)}, halo ${Math.round(corridorRule.envelope.halo)})`,
        });
      }
    }
  }

  const officeArea = findMetric(ruleset, 'office-area');
  const wcArea = findMetric(ruleset, 'wc-area');
  for (const office of offices) {
    if (officeArea && toM2(roomArea(office)) < officeArea.envelope.core - 0.05) {
      hardFails.push(
        `${office.name} ${toM2(roomArea(office)).toFixed(1)} m² < trdo jedro ${officeArea.envelope.core.toFixed(1)} m².`,
      );
    }
  }
  for (const wc of wcs) {
    if (wcArea && toM2(roomArea(wc)) < wcArea.envelope.core - 0.05) {
      hardFails.push(
        `${wc.name} ${toM2(roomArea(wc)).toFixed(1)} m² < trdo jedro ${wcArea.envelope.core.toFixed(1)} m².`,
      );
    }
  }

  // ── mehke kazni ────────────────────────────────────────────────
  const areaPenalties: number[] = [];
  if (officeArea) {
    for (const office of offices) areaPenalties.push(bandPenalty(toM2(roomArea(office)), officeArea));
  }
  if (wcArea) {
    for (const wc of wcs) areaPenalties.push(bandPenalty(toM2(roomArea(wc)), wcArea));
  }
  const area = mean(areaPenalties);
  if (officeArea && offices.length > 0) {
    const areas = offices.map((office) => toM2(roomArea(office)));
    checks.push({
      label: 'Kvadrature pisarn',
      status: area < 0.25 ? 'ok' : 'warn',
      detail: `${Math.min(...areas).toFixed(1)}–${Math.max(...areas).toFixed(1)} m² (halo ${officeArea.envelope.halo.toFixed(1)} m²)`,
    });
  }

  const wcDistRule = findMetric(ruleset, 'wc-entrance-dist');
  const wcPenalties: number[] = [];
  if (wcDistRule) {
    for (const wc of wcs) {
      const center = rectCenter(wc.rect);
      const dist = Math.abs(center.x - entrance.x) + Math.abs(center.y - entrance.y);
      const penalty = atMostPenalty(dist, wcDistRule);
      wcPenalties.push(penalty);
      checks.push({
        label: `${wc.name} → vhod`,
        status: penalty < 0.1 ? 'ok' : penalty < 0.5 ? 'warn' : 'fail',
        detail: `${(dist / 1000).toFixed(1)} m (halo ${(wcDistRule.envelope.halo / 1000).toFixed(1)} m, nasičenje ${(wcDistRule.envelope.sat / 1000).toFixed(1)} m)`,
      });
    }
  }
  const wcDist = mean(wcPenalties);

  const shareRule = findMetric(ruleset, 'corridor-share');
  let corridor = 0;
  const sharePct =
    (corridors.reduce((sum, room) => sum + roomArea(room), 0) / (plan.outline.w * plan.outline.h)) * 100;
  if (shareRule) {
    corridor = atMostPenalty(sharePct, shareRule);
    checks.push({
      label: 'Delež hodnika',
      status: corridor < 0.1 ? 'ok' : 'warn',
      detail: `${sharePct.toFixed(1)} % tlorisa (halo ${shareRule.envelope.halo.toFixed(1)} %, nasičenje ${shareRule.envelope.sat.toFixed(1)} %)`,
    });
  }

  const facadeRule = ruleset.adjacency.find((rule) => rule.key === 'office-on-facade');
  let facade = 0;
  if (facadeRule && offices.length > 0) {
    const onFacade = offices.filter((office) => touchesOutline(office.rect, plan.outline)).length;
    facade = ((offices.length - onFacade) / offices.length) * facadeRule.freq;
    checks.push({
      label: 'Pisarne ob fasadi',
      status: facade < 0.1 ? 'ok' : 'warn',
      detail: `${onFacade}/${offices.length} (referenčna pogostost ${(facadeRule.freq * 100).toFixed(0)} %)`,
    });
  }

  const wcAdj = ruleset.adjacency.find((rule) => rule.key === 'wc-adj-corridor');
  if (wcAdj?.hard) {
    checks.push({
      label: 'WC ob hodniku (trdo)',
      status: wcs.every((wc) => corridors.some((c) => rectsTouch(c.rect, wc.rect))) ? 'ok' : 'fail',
      detail: 'V 100 % referenc — trdo pravilo.',
    });
  }

  return {
    id: plan.id,
    plan,
    hardOk: hardFails.length === 0,
    hardFails,
    penalties: { area, wcDist, corridor, facade },
    checks,
  };
}

/** odstopanje od halo v obe smeri, normirano na širino ovojnice */
function bandPenalty(value: number, rule: MetricRule): number {
  const scale = Math.max((rule.envelope.sat - rule.envelope.core) / 2, rule.envelope.halo * 0.08, 1e-6);
  return Math.min(1, Math.abs(value - rule.envelope.halo) / (scale * 2));
}

/** pod halo brez kazni, halo→sat naraščajoče, nad sat strmo */
function atMostPenalty(value: number, rule: MetricRule): number {
  const { halo, sat } = rule.envelope;
  if (value <= halo) return 0;
  if (value <= sat) return (0.5 * (value - halo)) / Math.max(sat - halo, 1e-6);
  return Math.min(1, 0.5 + (0.5 * (value - sat)) / Math.max(sat, 1e-6));
}

function touchesOutline(
  rect: { x: number; y: number; w: number; h: number },
  outline: { x: number; y: number; w: number; h: number },
): boolean {
  const eps = 1;
  return (
    Math.abs(rect.x - outline.x) <= eps ||
    Math.abs(rect.y - outline.y) <= eps ||
    Math.abs(rect.x + rect.w - (outline.x + outline.w)) <= eps ||
    Math.abs(rect.y + rect.h - (outline.y + outline.h)) <= eps
  );
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
