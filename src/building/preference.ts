/**
 * A/B preferenčno učenje za kandidate stavb — isti mehanizem kot pri
 * opremi-v-sobi (engine/preference.ts), samo signali so na nivoju stavbe.
 * Uporabnikova izbira premakne utež signala, kjer se kandidata najbolj
 * razlikujeta; stabilen niz izbir → konvergenca.
 */

import type { BuildingCandidate, PenaltyKey } from './evaluator';

export type BuildingWeights = Record<PenaltyKey, number>;

export const SIGNAL_LABELS: Record<PenaltyKey, string> = {
  area: 'Kvadrature blizu halo',
  wcDist: 'WC blizu vhoda',
  corridor: 'Manj hodnika',
  facade: 'Pisarne ob fasadi',
};

export interface BuildingPreferenceState {
  weights: BuildingWeights;
  comparisons: number;
  dominantSignal: PenaltyKey | 'balanced';
  stableStreak: number;
  converged: boolean;
}

const KEYS: PenaltyKey[] = ['area', 'wcDist', 'corridor', 'facade'];

export function initialBuildingPreference(): BuildingPreferenceState {
  return {
    weights: { area: 0.25, wcDist: 0.25, corridor: 0.25, facade: 0.25 },
    comparisons: 0,
    dominantSignal: 'balanced',
    stableStreak: 0,
    converged: false,
  };
}

export function buildingScore(candidate: BuildingCandidate, weights: BuildingWeights): number {
  if (!candidate.hardOk) return 0;
  const penalty = KEYS.reduce((sum, key) => sum + weights[key] * candidate.penalties[key], 0);
  return Math.max(0, 1 - penalty);
}

export function rankBuildingCandidates(
  candidates: BuildingCandidate[],
  weights: BuildingWeights,
): BuildingCandidate[] {
  return [...candidates].sort((a, b) => buildingScore(b, weights) - buildingScore(a, weights));
}

export function recordBuildingPreference(
  state: BuildingPreferenceState,
  selected: BuildingCandidate,
  rejected: BuildingCandidate,
): BuildingPreferenceState {
  // signal = kje je izbrani najbolj boljši od zavrnjenega
  let signal: PenaltyKey | 'balanced' = 'balanced';
  let best = 0.02;
  for (const key of KEYS) {
    const delta = rejected.penalties[key] - selected.penalties[key];
    if (delta > best) {
      best = delta;
      signal = key;
    }
  }

  let weights = { ...state.weights };
  if (signal !== 'balanced') {
    weights[signal] += 0.08;
    weights = normalize(weights);
  }

  const stableStreak = signal === state.dominantSignal ? state.stableStreak + 1 : 1;
  const comparisons = state.comparisons + 1;
  return {
    weights,
    comparisons,
    dominantSignal: signal,
    stableStreak,
    converged: comparisons >= 5 && stableStreak >= 4,
  };
}

/** šampion (najboljši) proti izzivalcu, ki se od njega najbolj razlikuje po signalih */
export function pickBuildingPair(
  candidates: BuildingCandidate[],
  weights: BuildingWeights,
): [BuildingCandidate, BuildingCandidate] | null {
  const pool = rankBuildingCandidates(
    candidates.filter((candidate) => candidate.hardOk),
    weights,
  );
  if (pool.length < 2) return null;
  const champion = pool[0];
  let challenger = pool[1];
  let bestDisagreement = -1;
  for (const candidate of pool.slice(1, 7)) {
    const disagreement = KEYS.reduce(
      (sum, key) => sum + Math.abs(candidate.penalties[key] - champion.penalties[key]),
      0,
    );
    if (disagreement > bestDisagreement) {
      bestDisagreement = disagreement;
      challenger = candidate;
    }
  }
  return [champion, challenger];
}

function normalize(weights: BuildingWeights): BuildingWeights {
  const clamped = { ...weights };
  for (const key of KEYS) clamped[key] = Math.max(0.06, Math.min(0.7, clamped[key]));
  const sum = KEYS.reduce((total, key) => total + clamped[key], 0);
  for (const key of KEYS) clamped[key] /= sum;
  return clamped;
}
