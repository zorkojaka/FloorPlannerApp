import { describe, expect, it } from 'vitest';
import { baseReferences } from './references';
import { findMetric, induceBuildingRules } from './induction';
import { checkBriefFeasibility, generateBuildingCandidates, type BuildingBrief } from './generator';
import { evaluateBuildingCandidate } from './evaluator';
import {
  initialBuildingPreference,
  pickBuildingPair,
  rankBuildingCandidates,
  recordBuildingPreference,
} from './preference';
import { rectsOverlap, toM2, validateReferencePlan } from './schema';

const BRIEF: BuildingBrief = {
  W: 26000,
  D: 12500,
  entrance: { side: 'W', offset: 6200 },
  offices: 9,
  wcs: 2,
};

describe('reference set', () => {
  it('je veljaven po shemi in brez prekrivanj', () => {
    for (const plan of baseReferences()) {
      expect(() => validateReferencePlan(plan)).not.toThrow();
      for (let i = 0; i < plan.rooms.length; i += 1) {
        for (let j = i + 1; j < plan.rooms.length; j += 1) {
          expect(
            rectsOverlap(plan.rooms[i].rect, plan.rooms[j].rect, 5),
            `${plan.id}: ${plan.rooms[i].id} vs ${plan.rooms[j].id}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe('indukcija pravil stavbe', () => {
  const ruleset = induceBuildingRules(baseReferences());

  it('inducira vsa metrična pravila z envelope statistiko', () => {
    const officeArea = findMetric(ruleset, 'office-area');
    expect(officeArea).toBeDefined();
    expect(officeArea!.envelope.core).toBe(Math.min(...officeArea!.values));
    expect(officeArea!.envelope.core).toBeLessThanOrEqual(officeArea!.envelope.halo);
    expect(officeArea!.envelope.halo).toBeLessThanOrEqual(officeArea!.envelope.sat);

    const corridor = findMetric(ruleset, 'corridor-width');
    expect(corridor!.envelope.core).toBe(1650);
  });

  it('sosedstvo, ki drži povsod, je trdo; delno je mehko', () => {
    const wcAdj = ruleset.adjacency.find((rule) => rule.key === 'wc-adj-corridor');
    expect(wcAdj?.hard).toBe(true);
    const wcNear = ruleset.adjacency.find((rule) => rule.key === 'wc-near-entrance');
    expect(wcNear?.hard).toBe(false);
    expect(wcNear!.freq).toBeGreaterThan(0.5);
  });
});

describe('generator stavbe', () => {
  const ruleset = induceBuildingRules(baseReferences());

  it('generira kandidate, ki prestanejo trde kontrole', () => {
    const output = generateBuildingCandidates(BRIEF, ruleset, 8, 1);
    expect(output.infeasible).toBeUndefined();
    expect(output.plans.length).toBeGreaterThan(3);
    for (const plan of output.plans) {
      const candidate = evaluateBuildingCandidate(plan, BRIEF, ruleset);
      expect(candidate.hardFails, `${plan.id}: ${candidate.hardFails.join('; ')}`).toEqual([]);
    }
  });

  it('deluje tudi z vhodom na dolgi stranici (rotacija hodnika)', () => {
    const brief: BuildingBrief = { ...BRIEF, entrance: { side: 'N', offset: 12000 }, offices: 6 };
    const output = generateBuildingCandidates(brief, ruleset, 6, 2);
    expect(output.plans.length).toBeGreaterThan(0);
    for (const plan of output.plans) {
      const candidate = evaluateBuildingCandidate(plan, brief, ruleset);
      expect(candidate.hardFails, `${plan.id}: ${candidate.hardFails.join('; ')}`).toEqual([]);
    }
  });

  it('trdo neizvedljivo nalogo zavrne z razlogom, ne ugiba', () => {
    const brief: BuildingBrief = { ...BRIEF, W: 12000, D: 8000, offices: 12 };
    expect(checkBriefFeasibility(brief, ruleset)).toMatch(/Neizvedljivo/);
    const output = generateBuildingCandidates(brief, ruleset, 4, 1);
    expect(output.plans).toEqual([]);
    expect(output.infeasible).toMatch(/trda jedra/);
  });

  it('kandidati spoštujejo trda jedra kvadratur', () => {
    const ruleset2 = induceBuildingRules(baseReferences());
    const officeCore = findMetric(ruleset2, 'office-area')!.envelope.core;
    const output = generateBuildingCandidates(BRIEF, ruleset2, 6, 3);
    for (const plan of output.plans) {
      for (const room of plan.rooms.filter((r) => r.type === 'office')) {
        expect(toM2(room.rect.w * room.rect.h)).toBeGreaterThanOrEqual(officeCore - 0.05);
      }
    }
  });
});

describe('A/B preferenca', () => {
  const ruleset = induceBuildingRules(baseReferences());
  const output = generateBuildingCandidates(BRIEF, ruleset, 10, 1);
  const pool = output.plans.map((plan) => evaluateBuildingCandidate(plan, BRIEF, ruleset));

  it('izbere par šampion/izzivalec in premakne uteži', () => {
    let state = initialBuildingPreference();
    const pair = pickBuildingPair(pool, state.weights);
    expect(pair).not.toBeNull();
    const [a, b] = pair!;
    const next = recordBuildingPreference(state, a, b);
    expect(next.comparisons).toBe(1);
    const sum = Object.values(next.weights).reduce((total, weight) => total + weight, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('konvergira ob stabilnem nizu izbir', () => {
    let state = initialBuildingPreference();
    const ranked = rankBuildingCandidates(pool, state.weights);
    for (let i = 0; i < 6; i += 1) {
      state = recordBuildingPreference(state, ranked[0], ranked[ranked.length - 1]);
    }
    expect(state.comparisons).toBe(6);
    expect(state.converged).toBe(true);
  });
});
