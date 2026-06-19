import { describe, expect, it } from 'vitest';
import { induceRules } from './induction';
import {
  compareReferenceSetGeneration,
  GENEROUS_TOILET_REFERENCES,
  HOLDOUT_REFERENCES,
  measureLeaveOneOutHoldout,
} from './inductionEvaluation';

describe('induction holdout measurement', () => {
  it('induces envelopes with core as the minimum observed value and confidence from variance', () => {
    const rules = induceRules(HOLDOUT_REFERENCES);
    const toilet = rules.find((rule) => rule.elementKey === 'toilet')!;
    const sink = rules.find((rule) => rule.elementKey === 'sink')!;

    expect(toilet.envelope).toMatchObject({ core: 650, halo: 690, sat: 790, scope: 'room-type' });
    expect(toilet.mean).toBeCloseTo(686.67, 2);
    expect(toilet.variance).toBeCloseTo(822.22, 2);
    expect(toilet.envelope.conf).toBeCloseTo(0.933, 3);

    expect(sink.envelope).toMatchObject({ core: 540, halo: 590, sat: 690, scope: 'global' });
    expect(sink.mean).toBeCloseTo(583.33, 2);
    expect(sink.variance).toBeCloseTo(1088.89, 2);
    expect(sink.envelope.conf).toBeCloseTo(0.909, 3);
  });

  it('runs leave-one-out holdout per reference and reports concrete rows', () => {
    const report = measureLeaveOneOutHoldout(HOLDOUT_REFERENCES);

    expect(report.insideCount).toBe(4);
    expect(report.holdoutCount).toBe(6);
    expect(report.meanHaloOffset).toBe(40);
    expect(report.rows.map((row) => ({
      elementKey: row.elementKey,
      holdoutValue: row.holdoutValue,
      learned: `${row.learnedCore}-${row.learnedHalo}-${row.learnedSat}`,
      insideEnvelope: row.insideEnvelope,
      haloOffset: row.haloOffset,
    }))).toEqual([
      { elementKey: 'toilet', holdoutValue: 650, learned: '690-710-810', insideEnvelope: false, haloOffset: 60 },
      { elementKey: 'toilet', holdoutValue: 690, learned: '650-690-790', insideEnvelope: true, haloOffset: 0 },
      { elementKey: 'toilet', holdoutValue: 720, learned: '650-670-770', insideEnvelope: true, haloOffset: 50 },
      { elementKey: 'sink', holdoutValue: 540, learned: '590-610-710', insideEnvelope: false, haloOffset: 70 },
      { elementKey: 'sink', holdoutValue: 590, learned: '540-580-680', insideEnvelope: true, haloOffset: 10 },
      { elementKey: 'sink', holdoutValue: 620, learned: '540-570-670', insideEnvelope: true, haloOffset: 50 },
    ]);
  });

  it('changes induced rules when references are replaced by data, not code', () => {
    const baselineToilet = induceRules(HOLDOUT_REFERENCES).find((rule) => rule.elementKey === 'toilet')!;
    const generousToilet = induceRules(GENEROUS_TOILET_REFERENCES).find((rule) => rule.elementKey === 'toilet')!;

    expect(baselineToilet.envelope).toMatchObject({ core: 650, halo: 690, sat: 790 });
    expect(generousToilet.envelope).toMatchObject({ core: 800, halo: 820, sat: 920 });
    expect(generousToilet.envelope.halo - baselineToilet.envelope.halo).toBe(130);
  });

  it('changes deterministic generation metrics after the reference swap', () => {
    const [baseline, generous] = compareReferenceSetGeneration();

    expect(baseline.label).toBe('baseline');
    expect(generous.label).toBe('generous-toilet');
    expect(generous.rules.find((rule) => rule.elementKey === 'toilet')!.envelope.halo).toBeGreaterThan(
      baseline.rules.find((rule) => rule.elementKey === 'toilet')!.envelope.halo,
    );
    expect(baseline.validCount).toBe(65);
    expect(generous.validCount).toBe(64);
    expect(baseline.bestAisle).toBe(950);
    expect(generous.bestAisle).toBe(800);
    expect(baseline.meanHaloPenalty).toBeCloseTo(225.83, 2);
    expect(generous.meanHaloPenalty).toBe(0);
  });
});
