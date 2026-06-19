import type { ProgramInstance, RoomConfig } from '../constraints/brief';
import { baseLib } from '../elements/library';
import { generateLayoutPool } from '../engine/generator';
import { applyInducedRules, induceRules, type InducedRule, type ReferenceObservation } from './induction';

export const HOLDOUT_REFERENCES: ReferenceObservation[] = [
  { ref: 'WC-ref-01', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 650 },
  { ref: 'WC-ref-02', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 690 },
  { ref: 'WC-ref-03', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 720 },
  { ref: 'WC-ref-04', scope: 'global', elementKey: 'sink', parameter: 'clearance-front', value: 540 },
  { ref: 'WC-ref-05', scope: 'global', elementKey: 'sink', parameter: 'clearance-front', value: 590 },
  { ref: 'WC-ref-06', scope: 'global', elementKey: 'sink', parameter: 'clearance-front', value: 620 },
];

export const GENEROUS_TOILET_REFERENCES: ReferenceObservation[] = [
  { ref: 'ALT-ref-01', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 800 },
  { ref: 'ALT-ref-02', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 850 },
  { ref: 'ALT-ref-03', scope: 'room-type', elementKey: 'toilet', parameter: 'clearance-front', value: 820 },
  ...HOLDOUT_REFERENCES.filter((item) => item.elementKey !== 'toilet'),
];

export interface HoldoutRow {
  elementKey: string;
  holdoutRef: string;
  holdoutValue: number;
  learnedCore: number;
  learnedHalo: number;
  learnedSat: number;
  insideEnvelope: boolean;
  haloOffset: number;
}

export interface HoldoutReport {
  rows: HoldoutRow[];
  insideCount: number;
  holdoutCount: number;
  meanHaloOffset: number;
}

export interface ReferenceSetGeneration {
  label: string;
  rules: InducedRule[];
  validCount: number;
  bestScore: number;
  bestHaloPenalty: number;
  meanHaloPenalty: number;
  bestAisle: number;
}

export function measureLeaveOneOutHoldout(observations: ReferenceObservation[]): HoldoutReport {
  const rows: HoldoutRow[] = [];

  for (const holdout of observations) {
    const train = observations.filter((item) => item !== holdout);
    const rule = induceRules(train).find((candidate) =>
      candidate.elementKey === holdout.elementKey &&
      candidate.parameter === holdout.parameter &&
      candidate.envelope.scope === (holdout.scope || 'room-type'),
    );
    if (!rule) continue;

    const { core, halo, sat } = rule.envelope;
    rows.push({
      elementKey: holdout.elementKey,
      holdoutRef: holdout.ref,
      holdoutValue: holdout.value,
      learnedCore: core,
      learnedHalo: halo,
      learnedSat: sat,
      insideEnvelope: holdout.value >= core && holdout.value <= sat,
      haloOffset: Math.abs(holdout.value - halo),
    });
  }

  const insideCount = rows.filter((row) => row.insideEnvelope).length;
  const meanHaloOffset = rows.length ? rows.reduce((sum, row) => sum + row.haloOffset, 0) / rows.length : 0;

  return {
    rows,
    insideCount,
    holdoutCount: rows.length,
    meanHaloOffset,
  };
}

export function compareReferenceSetGeneration(): ReferenceSetGeneration[] {
  return [
    summarizeReferenceSet('baseline', HOLDOUT_REFERENCES),
    summarizeReferenceSet('generous-toilet', GENEROUS_TOILET_REFERENCES),
  ];
}

function summarizeReferenceSet(label: string, observations: ReferenceObservation[]): ReferenceSetGeneration {
  const rules = induceRules(observations);
  const library = applyInducedRules(baseLib(), rules);
  const pool = generateLayoutPool({
    library,
    program: defaultProgram(),
    cfg: defaultConfig(),
    soft: true,
    samples: 900,
    limit: 900,
    minPathWidth: 600,
    random: seededRandom(42),
  });
  const meanHaloPenalty = pool.length ? pool.reduce((sum, candidate) => sum + candidate.ev.halo, 0) / pool.length : 0;

  return {
    label,
    rules,
    validCount: pool.length,
    bestScore: pool[0]?.ev.score ?? 0,
    bestHaloPenalty: pool[0]?.ev.halo ?? 0,
    meanHaloPenalty,
    bestAisle: pool[0]?.ev.aisle ?? 0,
  };
}

function defaultProgram(): ProgramInstance[] {
  return [
    { id: 'door', key: 'door', w: 800, dir: 'auto', wall: 'auto', hinge: 'auto' },
    { id: 'toilet', key: 'toilet' },
    { id: 'sink', key: 'sink' },
  ];
}

function defaultConfig(): RoomConfig {
  return { W: 1900, D: 2200, wetWall: 'S', minAisle: 800 };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
