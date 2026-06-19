import type { ElementLibrary } from '../elements/library';
import type { Envelope, RuleScope } from './envelope';

export type InductionParameter = 'clearance-front';

export interface ReferenceObservation {
  ref: string;
  roomType?: string;
  scope?: RuleScope;
  elementKey: string;
  parameter: InductionParameter;
  value: number;
  note?: string;
}

export interface InducedRule {
  id: string;
  elementKey: string;
  parameter: InductionParameter;
  envelope: Envelope;
  count: number;
  mean: number;
  variance: number;
  references: string[];
}

export function induceRules(observations: ReferenceObservation[]): InducedRule[] {
  const grouped = new Map<string, ReferenceObservation[]>();

  for (const observation of observations) {
    if (!Number.isFinite(observation.value)) continue;
    const scope = observation.scope || 'room-type';
    const key = `${observation.elementKey}:${observation.parameter}:${scope}`;
    grouped.set(key, [...(grouped.get(key) || []), { ...observation, scope }]);
  }

  return [...grouped.entries()].map(([id, group]) => {
    const values = group.map((item) => item.value).sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const standardDeviation = Math.sqrt(variance);
    const conf = confidenceFromVariance(mean, standardDeviation);
    const core = Math.min(...values);
    const halo = Math.round(percentile(values, 0.5) / 10) * 10;
    const sat = Math.round(Math.max(percentile(values, 0.9), halo + 100) / 10) * 10;

    return {
      id,
      elementKey: group[0].elementKey,
      parameter: group[0].parameter,
      envelope: {
        core,
        halo: Math.max(halo, core + 10),
        sat,
        conf,
        scope: group[0].scope || 'room-type',
      },
      count: group.length,
      mean,
      variance,
      references: group.map((item) => item.ref),
    };
  });
}

export function applyInducedRules(library: ElementLibrary, rules: InducedRule[]): ElementLibrary {
  const next: ElementLibrary = JSON.parse(JSON.stringify(library));

  for (const rule of rules) {
    const element = next[rule.elementKey];
    if (!element) continue;
    if (rule.parameter === 'clearance-front') {
      element.clear = { ...rule.envelope };
      if (element.source !== 'user') element.source = 'ifc';
    }
  }

  return next;
}

export function parseReferenceJson(raw: string): ReferenceObservation[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Reference morajo biti JSON array.');
  return parsed.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Referenca #${index + 1} ni objekt.`);
    if (typeof item.ref !== 'string') throw new Error(`Referenca #${index + 1} nima polja ref.`);
    if (typeof item.elementKey !== 'string') throw new Error(`Referenca ${item.ref} nima polja elementKey.`);
    if (item.parameter !== 'clearance-front') throw new Error(`Referenca ${item.ref} ima nepodprt parameter.`);
    if (!Number.isFinite(item.value)) throw new Error(`Referenca ${item.ref} nima numericne value.`);
    return item as ReferenceObservation;
  });
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
