/**
 * Indukcija pravil na nivoju stavbe: iz referenčnih načrtov izlušči
 * metrična pravila (envelope: min→core, mediana→halo, p90→sat, zaupanje iz
 * variance — ista statistika kot indukcija na nivoju sobe) in frekvenčna
 * pravila sosedstev (delež referenc, kjer relacija drži; 100 % → trdo).
 */

import type { Envelope } from '../rules/envelope';
import {
  entrancePoint,
  rectCenter,
  rectsTouch,
  roomArea,
  toM2,
  type ReferencePlan,
} from './schema';

export type MetricKey =
  | 'office-area'
  | 'office-depth'
  | 'wc-area'
  | 'corridor-width'
  | 'wc-entrance-dist'
  | 'corridor-share';

/**
 * band: vrednost naj bo blizu halo (odmik v obe smeri kaznovan)
 * atLeast: vrednost naj ne pade pod core
 * atMost: vrednost naj ne preseže sat
 */
export type MetricMode = 'band' | 'atLeast' | 'atMost';

export interface MetricRule {
  key: MetricKey;
  label: string;
  unit: 'm2' | 'mm' | '%';
  mode: MetricMode;
  envelope: Envelope;
  count: number;
  mean: number;
  values: number[];
  references: string[];
}

export type AdjacencyKey =
  | 'office-adj-corridor'
  | 'wc-adj-corridor'
  | 'office-on-facade'
  | 'wc-near-entrance';

export interface AdjacencyRule {
  key: AdjacencyKey;
  label: string;
  /** delež referenc/sob, kjer relacija drži */
  freq: number;
  observed: number;
  total: number;
  hard: boolean;
}

export interface BuildingRuleset {
  metrics: MetricRule[];
  adjacency: AdjacencyRule[];
  referenceIds: string[];
}

interface MetricSample {
  ref: string;
  value: number;
}

export function induceBuildingRules(plans: ReferencePlan[]): BuildingRuleset {
  const samples = new Map<MetricKey, MetricSample[]>();
  const push = (key: MetricKey, ref: string, value: number) => {
    if (!Number.isFinite(value)) return;
    samples.set(key, [...(samples.get(key) || []), { ref, value }]);
  };

  const adjacencyCounts: Record<AdjacencyKey, { observed: number; total: number }> = {
    'office-adj-corridor': { observed: 0, total: 0 },
    'wc-adj-corridor': { observed: 0, total: 0 },
    'office-on-facade': { observed: 0, total: 0 },
    'wc-near-entrance': { observed: 0, total: 0 },
  };

  for (const plan of plans) {
    const corridors = plan.rooms.filter((room) => room.type === 'corridor');
    const entrance = plan.entrances[0] ? entrancePoint(plan.outline, plan.entrances[0]) : null;
    const totalArea = plan.outline.w * plan.outline.h;
    const corridorArea = corridors.reduce((sum, room) => sum + roomArea(room), 0);
    if (totalArea > 0 && corridorArea > 0) {
      push('corridor-share', plan.id, (corridorArea / totalArea) * 100);
    }
    for (const corridor of corridors) {
      push('corridor-width', plan.id, Math.min(corridor.rect.w, corridor.rect.h));
    }

    for (const room of plan.rooms) {
      const adjCorridor = corridors.some((c) => rectsTouch(c.rect, room.rect));
      const onFacade = touchesOutline(room.rect, plan.outline);
      if (room.type === 'office') {
        push('office-area', plan.id, toM2(roomArea(room)));
        push('office-depth', plan.id, officeDepth(room.rect, corridors));
        adjacencyCounts['office-adj-corridor'].total += 1;
        if (adjCorridor) adjacencyCounts['office-adj-corridor'].observed += 1;
        adjacencyCounts['office-on-facade'].total += 1;
        if (onFacade) adjacencyCounts['office-on-facade'].observed += 1;
      }
      if (room.type === 'wc') {
        push('wc-area', plan.id, toM2(roomArea(room)));
        adjacencyCounts['wc-adj-corridor'].total += 1;
        if (adjCorridor) adjacencyCounts['wc-adj-corridor'].observed += 1;
        if (entrance) {
          const center = rectCenter(room.rect);
          const dist = Math.abs(center.x - entrance.x) + Math.abs(center.y - entrance.y);
          push('wc-entrance-dist', plan.id, dist);
          adjacencyCounts['wc-near-entrance'].total += 1;
          if (dist <= 8000) adjacencyCounts['wc-near-entrance'].observed += 1;
        }
      }
    }
  }

  const metricMeta: Record<MetricKey, { label: string; unit: MetricRule['unit']; mode: MetricMode }> = {
    'office-area': { label: 'Kvadratura pisarne', unit: 'm2', mode: 'band' },
    'office-depth': { label: 'Globina pisarne', unit: 'mm', mode: 'band' },
    'wc-area': { label: 'Kvadratura WC', unit: 'm2', mode: 'band' },
    'corridor-width': { label: 'Širina hodnika', unit: 'mm', mode: 'atLeast' },
    'wc-entrance-dist': { label: 'Razdalja WC → vhod', unit: 'mm', mode: 'atMost' },
    'corridor-share': { label: 'Delež hodnika v tlorisu', unit: '%', mode: 'atMost' },
  };

  const metrics: MetricRule[] = [...samples.entries()].map(([key, group]) => {
    const values = group.map((sample) => sample.value).sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const meta = metricMeta[key];
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      mode: meta.mode,
      envelope: {
        core: values[0],
        halo: percentile(values, 0.5),
        sat: percentile(values, 0.9),
        conf: confidenceFromVariance(mean, Math.sqrt(variance)),
        scope: 'global',
      },
      count: values.length,
      mean,
      values,
      references: [...new Set(group.map((sample) => sample.ref))],
    };
  });

  const adjacencyMeta: Record<AdjacencyKey, string> = {
    'office-adj-corridor': 'Pisarna ima vrata na hodnik',
    'wc-adj-corridor': 'WC ima vrata na hodnik',
    'office-on-facade': 'Pisarna leži ob fasadi (dnevna svetloba)',
    'wc-near-entrance': 'WC je blizu vhoda (≤ 8 m)',
  };

  const adjacency: AdjacencyRule[] = (Object.keys(adjacencyCounts) as AdjacencyKey[])
    .filter((key) => adjacencyCounts[key].total > 0)
    .map((key) => {
      const { observed, total } = adjacencyCounts[key];
      const freq = observed / total;
      return { key, label: adjacencyMeta[key], freq, observed, total, hard: freq >= 0.999 };
    });

  return { metrics, adjacency, referenceIds: plans.map((plan) => plan.id) };
}

export function findMetric(ruleset: BuildingRuleset, key: MetricKey): MetricRule | undefined {
  return ruleset.metrics.find((rule) => rule.key === key);
}

/** Globina pisarne = dimenzija pravokotno na hodnik, ob katerem soba leži. */
function officeDepth(rect: { x: number; y: number; w: number; h: number }, corridors: ReferencePlan['rooms']): number {
  for (const corridor of corridors) {
    if (!rectsTouch(corridor.rect, rect)) continue;
    const horizontal = corridor.rect.w >= corridor.rect.h;
    return horizontal ? rect.h : rect.w;
  }
  return Math.min(rect.w, rect.h);
}

function touchesOutline(rect: { x: number; y: number; w: number; h: number }, outline: { x: number; y: number; w: number; h: number }): boolean {
  const eps = 1;
  return (
    Math.abs(rect.x - outline.x) <= eps ||
    Math.abs(rect.y - outline.y) <= eps ||
    Math.abs(rect.x + rect.w - (outline.x + outline.w)) <= eps ||
    Math.abs(rect.y + rect.h - (outline.y + outline.h)) <= eps
  );
}

function confidenceFromVariance(mean: number, standardDeviation: number): number {
  if (mean <= 0) return 0.2;
  const coefficient = standardDeviation / mean;
  return Math.max(0.2, Math.min(0.98, 1 - coefficient * 1.6));
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const ratio = index - lower;
  return sortedValues[lower] * (1 - ratio) + sortedValues[upper] * ratio;
}
