import { describe, expect, it } from 'vitest';
import { induceZoneProfile, zoneProfileSummary } from './zoneInduction';
import { generateStripFloorLayout } from './floorGenerator';
import { zoneContiguity } from './floorPreference';
import { projectTrainingFromNormalizedPlan } from './projectTraining';
import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import type { ProjectBrief } from './roomTypes';

const room = (sourceId: string, roomType: 'office' | 'wc', w: number, d: number, zone?: string) => ({
  sourceId,
  name: sourceId,
  roomType,
  zone,
  w,
  d,
  elements: [],
});

const PLAN_WITH_ZONES: NormalizedIfcPlan = {
  sourceId: 'gmp1',
  name: 'GMP obrat',
  corridors: [{ sourceId: 'c1', name: 'Hodnik', role: 'main', width: 1800 }],
  rooms: [
    room('proizvodnja-1', 'office', 6000, 5000, 'technical'),
    room('proizvodnja-2', 'office', 6000, 5000, 'technical'),
    room('pisarna-1', 'office', 4000, 4000, 'work'),
    room('wc-m', 'wc', 2400, 2200, 'sanitary'),
  ],
};

const PLAN_NO_ZONES: NormalizedIfcPlan = {
  sourceId: 'plain',
  name: 'Brez con',
  corridors: [],
  rooms: [room('o1', 'office', 4000, 4000), room('w1', 'wc', 2400, 2200)],
};

describe('induceZoneProfile', () => {
  it('bere eksplicitne cone iz uvoza in nauči preslikavo tip→cona', () => {
    const profile = induceZoneProfile(PLAN_WITH_ZONES);
    expect(profile.source).toBe('import');
    // prevladujoča cona za office je technical (2 vs 1)
    expect(profile.zoneByType.office).toBe('technical');
    expect(profile.zoneByType.wc).toBe('sanitary');
    expect(profile.distinctZones).toBe(3);
    const shares = profile.stats.reduce((sum, stat) => sum + stat.areaShare, 0);
    expect(shares).toBeCloseTo(1, 5);
    // največja cona (technical, 2×30 m²) je prva
    expect(profile.stats[0].zone).toBe('technical');
    expect(zoneProfileSummary(profile)).toContain('%');
  });

  it('sklepa cone iz tipov, ko uvoz nima eksplicitnih con', () => {
    const profile = induceZoneProfile(PLAN_NO_ZONES);
    expect(profile.source).toBe('derived');
    expect(profile.zoneByType.office).toBe('work');
    expect(profile.zoneByType.wc).toBe('sanitary');
  });
});

describe('cone tečejo v projektni brief in generator', () => {
  it('projectTraining pripne cone na programe in rezultat', () => {
    const training = projectTrainingFromNormalizedPlan(PLAN_WITH_ZONES);
    expect(training.zoneSource).toBe('import');
    expect(training.zones.length).toBeGreaterThan(0);
    const office = training.brief.rooms.find((r) => r.id === 'office');
    expect(office?.zone).toBe('technical');
  });

  it('generator prenese cono na postavljene prostore', () => {
    const training = projectTrainingFromNormalizedPlan(PLAN_WITH_ZONES);
    const layout = generateStripFloorLayout(training.brief, { roomOrder: 'zone-cluster' });
    expect(layout.rooms.every((r) => r.zone)).toBe(true);
    expect(layout.rooms.some((r) => r.zone === 'technical')).toBe(true);
  });
});

describe('zoneContiguity A/B signal', () => {
  const brief: ProjectBrief = {
    id: 'zc',
    name: 'ZC',
    boundary: { area: 160, width: 16, depth: 10 },
    rooms: [
      { id: 'office', type: 'office', count: 3 },
      { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
      { id: 'wc-women', type: 'wc', wcKind: 'female', count: 1 },
      { id: 'corridor', type: 'corridor', count: 1 },
    ],
  };

  it('gnezdena razporeditev con ni slabša od premešane', () => {
    const clustered = generateStripFloorLayout(brief, { roomOrder: 'zone-cluster' });
    const alternating = generateStripFloorLayout(brief, { roomOrder: 'alternating' });
    expect(zoneContiguity(clustered)).toBeGreaterThanOrEqual(zoneContiguity(alternating));
  });
});
