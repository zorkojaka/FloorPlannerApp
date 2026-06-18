import type { LayoutCandidate } from './generator';

export interface PreferenceWeights {
  halo: number;
  drain: number;
}

export interface PreferenceState {
  weights: PreferenceWeights;
  comparisons: number;
  dominantSignal: 'halo' | 'drain' | 'balanced';
  stableStreak: number;
  converged: boolean;
}

export function initialPreferenceState(): PreferenceState {
  return {
    weights: { halo: 0.5, drain: 0.5 },
    comparisons: 0,
    dominantSignal: 'balanced',
    stableStreak: 0,
    converged: false,
  };
}

export function preferenceScore(candidate: LayoutCandidate, weights: PreferenceWeights): number {
  const haloPenalty = Math.min(candidate.ev.halo / 1_000_000, 1);
  const drainPenalty = Math.min(candidate.ev.drain / 5000, 1);
  return 1 - (weights.halo * haloPenalty + weights.drain * drainPenalty);
}

export function recordPreference(
  state: PreferenceState,
  selected: LayoutCandidate,
  rejected: LayoutCandidate,
): PreferenceState {
  const selectedHalo = selected.ev.halo;
  const rejectedHalo = rejected.ev.halo;
  const selectedDrain = selected.ev.drain;
  const rejectedDrain = rejected.ev.drain;

  const haloBetter = selectedHalo < rejectedHalo;
  const drainBetter = selectedDrain < rejectedDrain;
  const signal = inferSignal(haloBetter, drainBetter, selected, rejected);
  const adjustment = 0.06;
  let weights = { ...state.weights };

  if (signal === 'halo') {
    weights = normalize({ halo: weights.halo + adjustment, drain: weights.drain - adjustment });
  } else if (signal === 'drain') {
    weights = normalize({ halo: weights.halo - adjustment, drain: weights.drain + adjustment });
  }

  const stableStreak = signal === state.dominantSignal ? state.stableStreak + 1 : 1;
  const comparisons = state.comparisons + 1;
  const converged = comparisons >= 5 && stableStreak >= 4;

  return {
    weights,
    comparisons,
    dominantSignal: signal,
    stableStreak,
    converged,
  };
}

export function rankByPreference(candidates: LayoutCandidate[], weights: PreferenceWeights): LayoutCandidate[] {
  return [...candidates].sort((a, b) => preferenceScore(b, weights) - preferenceScore(a, weights));
}

function inferSignal(
  haloBetter: boolean,
  drainBetter: boolean,
  selected: LayoutCandidate,
  rejected: LayoutCandidate,
): PreferenceState['dominantSignal'] {
  if (haloBetter && !drainBetter) return 'halo';
  if (drainBetter && !haloBetter) return 'drain';
  if (haloBetter && drainBetter) {
    const haloDelta = Math.abs(selected.ev.halo - rejected.ev.halo) / 1_000_000;
    const drainDelta = Math.abs(selected.ev.drain - rejected.ev.drain) / 1000;
    if (haloDelta > drainDelta) return 'halo';
    if (drainDelta > haloDelta) return 'drain';
  }
  return 'balanced';
}

function normalize(weights: PreferenceWeights): PreferenceWeights {
  const halo = Math.max(0.1, Math.min(0.9, weights.halo));
  const drain = Math.max(0.1, Math.min(0.9, weights.drain));
  const sum = halo + drain;
  return { halo: halo / sum, drain: drain / sum };
}
