import type { PreferenceState } from './preference';
import type { ReferenceObservation } from '../rules/induction';
import { induceRules } from '../rules/induction';
import { measureLeaveOneOutHoldout } from '../rules/inductionEvaluation';

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

  const report = measureLeaveOneOutHoldout(observations);
  const score = report.holdoutCount ? report.insideCount / report.holdoutCount : 0;

  return {
    trainCount: observations.length - 1,
    holdoutCount: report.holdoutCount,
    meanAbsoluteError: report.meanHaloOffset,
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
