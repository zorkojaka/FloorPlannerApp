import type { PreferenceState } from './preference';
import type { ReferenceObservation } from '../rules/induction';
import { induceRules } from '../rules/induction';

export interface InductionMetric {
  trainCount: number;
  holdoutCount: number;
  meanAbsoluteError: number;
  score: number;
}

export interface GeneralizationMetric {
  ruleCount: number;
  averageConfidence: number;
  score: number;
}

export function measureInductionHoldout(observations: ReferenceObservation[]): InductionMetric {
  if (observations.length < 3) {
    return { trainCount: observations.length, holdoutCount: 0, meanAbsoluteError: 0, score: 0 };
  }

  const split = Math.max(1, Math.floor(observations.length * 0.67));
  const train = observations.slice(0, split);
  const holdout = observations.slice(split);
  const rules = induceRules(train);
  const errors: number[] = [];

  for (const item of holdout) {
    const rule = rules.find((candidate) => candidate.elementKey === item.elementKey && candidate.parameter === item.parameter);
    if (!rule) continue;
    errors.push(Math.abs(rule.envelope.halo - item.value));
  }

  const meanAbsoluteError = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : 0;
  const score = errors.length ? Math.max(0, Math.min(1, 1 - meanAbsoluteError / 1000)) : 0;

  return {
    trainCount: train.length,
    holdoutCount: holdout.length,
    meanAbsoluteError,
    score,
  };
}

export function measureGeneralization(observations: ReferenceObservation[]): GeneralizationMetric {
  const rules = induceRules(observations);
  const averageConfidence = rules.length
    ? rules.reduce((sum, rule) => sum + rule.envelope.conf, 0) / rules.length
    : 0;

  return {
    ruleCount: rules.length,
    averageConfidence,
    score: averageConfidence * Math.min(1, rules.length / 3),
  };
}

export function measurePreferenceGain(state: PreferenceState): number {
  return Math.min(1, Math.abs(state.weights.halo - 0.5) + Math.abs(state.weights.drain - 0.5));
}
