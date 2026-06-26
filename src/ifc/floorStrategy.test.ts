import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool } from '../project/floorGenerator';
import type { ProjectBrief } from '../project/roomTypes';
import { extractFloorStrategyObservations, induceFloorStrategyProfile, rankFloorLayoutsByProfile } from './floorStrategy';
import type { NormalizedIfcPlan } from './normalizedPlan';

function refPlan(sourceId: string, wcOffsets: number[], sideCorridors: number): NormalizedIfcPlan {
  return {
    sourceId,
    name: sourceId,
    corridors: [
      { sourceId: 'main', name: 'Main corridor', role: 'main', width: sideCorridors > 0 ? 2200 : 1800 },
      ...Array.from({ length: sideCorridors }, (_, i) => ({ sourceId: `side-${i + 1}`, name: `Side ${i + 1}`, role: 'side' as const, width: 1300 })),
    ],
    rooms: wcOffsets.map((offset, index) => ({
      sourceId: `wc-${index + 1}`,
      name: `WC ${index + 1}`,
      roomType: 'wc',
      w: 2000,
      d: 2400,
      elements: [{ sourceId: `toilet-${index + 1}`, name: 'Toilet', elementKey: 'toilet', x: offset, y: 0, w: 400, d: 600, facing: 'N' }],
    })),
  };
}

describe('floor strategy induction proof', () => {
  const brief: ProjectBrief = {
    id: 'proof',
    name: 'Proof',
    boundary: { area: 1600, width: 40, depth: 40 },
    corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
    entrances: [{ id: 'entry', wall: 'E', position: 0.55, width: 1.2 }],
    rooms: [
      { id: 'wc', type: 'wc', count: 4 },
      { id: 'office', type: 'office', count: 12, workstations: 1 },
      { id: 'corridor', type: 'corridor', count: 1 },
    ],
  };

  it('learns different profiles from clustered and dispersed references and changes top ranked strategy', () => {
    const clustered = induceFloorStrategyProfile('clustered', extractFloorStrategyObservations(refPlan('clustered', [0, 700, 1300, 1900], 0)));
    const dispersed = induceFloorStrategyProfile('dispersed', extractFloorStrategyObservations(refPlan('dispersed', [0, 9000, 18000, 27000], 2)));
    expect(clustered.preferClusteredWc).toBeGreaterThan(clustered.preferSpreadWc);
    expect(dispersed.preferSpreadWc).toBeGreaterThan(dispersed.preferClusteredWc);
    expect(dispersed.preferInternalCorridors).toBeGreaterThan(clustered.preferInternalCorridors);

    const pool = generateFloorLayoutPool(brief);
    const clusteredTop = rankFloorLayoutsByProfile(pool, clustered)[0];
    const dispersedTop = rankFloorLayoutsByProfile(pool, dispersed)[0];
    expect(clusteredTop.variant).not.toBe(dispersedTop.variant);
    expect(dispersedTop.variant).toMatch(/spread-wc|alternating|center-cross|thirds/);
  });
});
