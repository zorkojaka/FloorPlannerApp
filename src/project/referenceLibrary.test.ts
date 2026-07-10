import { describe, expect, it } from 'vitest';
import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import {
  addReference,
  floorHoldoutReport,
  floorTrainingFromLibrary,
  inferReferenceKind,
  initialReferenceLibrary,
  normalizeReferenceLibrary,
  referencesOfKind,
  referenceSummary,
  removeReference,
  roomRuleSetsFromLibrary,
} from './referenceLibrary';
import { furnishFloorLayout } from './floorFurnish';
import { generateStripFloorLayout } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

function wcPlan(id: string): NormalizedIfcPlan {
  return {
    sourceId: id,
    name: `WC ${id}`,
    rooms: [
      {
        sourceId: `${id}-r1`,
        name: 'WC',
        roomType: 'wc',
        w: 1800,
        d: 2200,
        elements: [{ sourceId: `${id}-e1`, name: 'WC', elementKey: 'toilet', x: 100, y: 100, w: 400, d: 600, facing: 'N' }],
      },
    ],
  };
}

function floorPlan(id: string, corridorWidth: number, wcCount: number): NormalizedIfcPlan {
  return {
    sourceId: id,
    name: `Etaža ${id}`,
    corridors: [{ sourceId: `${id}-c1`, name: 'Hodnik', role: 'main', width: corridorWidth }],
    rooms: [
      ...Array.from({ length: wcCount }, (_, i) => ({
        sourceId: `${id}-wc-${i}`,
        name: `WC ${i}`,
        roomType: 'wc' as const,
        w: 1800,
        d: 2200,
        elements: [],
      })),
      { sourceId: `${id}-o1`, name: 'Pisarna 1', roomType: 'office' as const, w: 3600, d: 4200, elements: [] },
      { sourceId: `${id}-o2`, name: 'Pisarna 2', roomType: 'office' as const, w: 3400, d: 4000, elements: [] },
    ],
  };
}

describe('knjižnica referenčnih načrtov (FP-005)', () => {
  it('shrani reference s tipom in povzetkom, vidne po vrstah', () => {
    let lib = initialReferenceLibrary();
    for (let i = 1; i <= 3; i++) lib = addReference(lib, { plan: wcPlan(`wc-${i}`), kind: 'wc', source: 'ai' });
    lib = addReference(lib, { plan: floorPlan('f1', 1800, 2), source: 'ifc' });
    lib = addReference(lib, { plan: floorPlan('f2', 2400, 1), source: 'ai' });

    expect(referencesOfKind(lib, 'wc')).toHaveLength(3);
    expect(referencesOfKind(lib, 'floor')).toHaveLength(2);
    expect(referenceSummary(referencesOfKind(lib, 'floor')[0])).toContain('4 prostorov');
    expect(referenceSummary(referencesOfKind(lib, 'wc')[0])).toContain('1 elementov');
  });

  it('samodejno sklepa tip reference iz vsebine', () => {
    expect(inferReferenceKind(wcPlan('x'))).toBe('wc');
    expect(inferReferenceKind(floorPlan('y', 1800, 1))).toBe('floor');
  });

  it('odstranitev reference preračuna induciran profil brez spremembe kode', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: floorPlan('f1', 1500, 3), source: 'ai' });
    lib = addReference(lib, { plan: floorPlan('f2', 2600, 0), source: 'ai' });

    const both = floorTrainingFromLibrary(lib)!;
    expect(both.referenceCount).toBe(2);

    const f2Id = referencesOfKind(lib, 'floor')[1].id;
    const onlyFirst = floorTrainingFromLibrary(removeReference(lib, f2Id))!;
    expect(onlyFirst.referenceCount).toBe(1);
    // profil se spremeni: druga referenca (širok hodnik, brez WC) ne vpliva več
    expect(JSON.stringify(onlyFirst.profile)).not.toEqual(JSON.stringify(both.profile));
    // brief pride iz zadnje preostale etažne reference
    expect(onlyFirst.training.sourceId).toBe('f1');
  });

  it('knjižnica preživi serializacijo in okvarjene zapise', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: wcPlan('w'), kind: 'wc' });
    const restored = normalizeReferenceLibrary(JSON.parse(JSON.stringify(lib)));
    expect(restored.references).toHaveLength(1);
    expect(restored.references[0].kind).toBe('wc');
    // okvarjen zapis iz shrambe ne podre aplikacije
    expect(normalizeReferenceLibrary({ references: [null, { id: 'x' }] } as never).references).toHaveLength(0);
    expect(normalizeReferenceLibrary(undefined).references).toHaveLength(0);
  });

  it('brez etažnih referenc ni etažnega treninga', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: wcPlan('w'), kind: 'wc' });
    expect(floorTrainingFromLibrary(lib)).toBeNull();
  });
});

function wcPlanWithClearance(id: string, clearanceMm: number): NormalizedIfcPlan {
  const roomD = 2200;
  const toiletD = 600;
  return {
    sourceId: id,
    name: `WC ${id}`,
    rooms: [
      {
        sourceId: `${id}-r1`,
        name: 'WC',
        roomType: 'wc',
        w: 1800,
        d: roomD,
        // facing N → clearance-front = d − (y + toiletD); y izberemo, da dobimo želeni odmik
        elements: [{ sourceId: `${id}-e1`, name: 'WC', elementKey: 'toilet', x: 200, y: roomD - toiletD - clearanceMm, w: 400, d: toiletD, facing: 'N' }],
      },
    ],
  };
}

function officePlanWithClearance(id: string, clearanceMm: number): NormalizedIfcPlan {
  const roomD = 4200;
  const deskD = 800;
  return {
    sourceId: id,
    name: `Pisarna ${id}`,
    rooms: [
      {
        sourceId: `${id}-r1`,
        name: 'Pisarna',
        roomType: 'office',
        w: 3600,
        d: roomD,
        elements: [{ sourceId: `${id}-e1`, name: 'Miza', elementKey: 'desk', x: 300, y: roomD - deskD - clearanceMm, w: 1400, d: deskD, facing: 'N' }],
      },
    ],
  };
}

describe('holdout validacija etažne indukcije (FP-007)', () => {
  it('z manj kot dvema etažnima referencama poročila ni', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: floorPlan('f1', 1800, 2), kind: 'floor' });
    expect(floorHoldoutReport(lib)).toBeNull();
  });

  it('enake reference → visoko ujemanje; različne → nižje, za vsak parameter številka', () => {
    let same = initialReferenceLibrary();
    same = addReference(same, { plan: floorPlan('a1', 1800, 2), kind: 'floor' });
    same = addReference(same, { plan: floorPlan('a2', 1800, 2), kind: 'floor' });
    const sameReport = floorHoldoutReport(same)!;
    expect(sameReport.referenceCount).toBe(2);
    expect(sameReport.score).toBeGreaterThan(0.9);
    expect(sameReport.parameters.length).toBeGreaterThan(0);
    for (const parameter of sameReport.parameters) {
      expect(parameter.match).toBeGreaterThanOrEqual(0);
      expect(parameter.match).toBeLessThanOrEqual(1);
      expect(parameter.label.length).toBeGreaterThan(0);
    }

    let diff = initialReferenceLibrary();
    diff = addReference(diff, { plan: floorPlan('b1', 1200, 3), kind: 'floor' });
    diff = addReference(diff, { plan: floorPlan('b2', 3200, 0), kind: 'floor' });
    const diffReport = floorHoldoutReport(diff)!;
    expect(diffReport.score).toBeLessThan(sameReport.score);
    const mainWidth = diffReport.parameters.find((parameter) => parameter.metric === 'corridor-width-main')!;
    expect(mainWidth.match).toBeLessThan(0.7);
  });
});

describe('indukcija pravil pohištva per tip sobe (FP-006)', () => {
  it('pravila so ločena per tip sobe in citirajo reference', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: wcPlanWithClearance('w1', 600), kind: 'wc' });
    lib = addReference(lib, { plan: wcPlanWithClearance('w2', 750), kind: 'wc' });
    lib = addReference(lib, { plan: officePlanWithClearance('o1', 1000), kind: 'office' });

    const sets = roomRuleSetsFromLibrary(lib);
    expect(Object.keys(sets).sort()).toEqual(['office', 'wc']);
    const wcRule = sets.wc.find((rule) => rule.elementKey === 'toilet' && rule.parameter === 'clearance-front')!;
    expect(wcRule.count).toBe(2);
    expect(wcRule.envelope.core).toBe(600); // min → trdo jedro
    expect(wcRule.references.join(' ')).toContain('w1');
    expect(sets.office.every((rule) => rule.elementKey !== 'toilet')).toBe(true);
  });

  it('zamenjava WC referenc spremeni WC pravila, pisarniška ostanejo', () => {
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: wcPlanWithClearance('w1', 600), kind: 'wc' });
    lib = addReference(lib, { plan: officePlanWithClearance('o1', 1000), kind: 'office' });
    const before = roomRuleSetsFromLibrary(lib);

    const wcId = referencesOfKind(lib, 'wc')[0].id;
    let swapped = removeReference(lib, wcId);
    swapped = addReference(swapped, { plan: wcPlanWithClearance('w9', 1100), kind: 'wc' });
    const after = roomRuleSetsFromLibrary(swapped);

    expect(after.wc[0].envelope.core).not.toBe(before.wc[0].envelope.core);
    expect(JSON.stringify(after.office)).toBe(JSON.stringify(before.office));
  });

  it('inducirana pravila spremenijo opremljanje brez spremembe kode', () => {
    const brief: ProjectBrief = {
      id: 'rules-demo',
      name: 'Rules demo',
      boundary: { area: 120, width: 15, depth: 8 },
      corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
      rooms: [
        { id: 'wc', type: 'wc', count: 1 },
        { id: 'office', type: 'office', count: 2, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    };
    const layout = generateStripFloorLayout(brief);

    // ekstremno pravilo: WC školjka zahteva ogromen čelni odmik → postavitve se morajo spremeniti
    let lib = initialReferenceLibrary();
    lib = addReference(lib, { plan: wcPlanWithClearance('big1', 1900), kind: 'wc' });
    lib = addReference(lib, { plan: wcPlanWithClearance('big2', 2000), kind: 'wc' });
    const sets = roomRuleSetsFromLibrary(lib);

    const plain = furnishFloorLayout(layout, {});
    const ruled = furnishFloorLayout(layout, {}, undefined, sets);
    const plainWc = plain.results.filter((r) => r.room.type === 'wc');
    const ruledWc = ruled.results.filter((r) => r.room.type === 'wc');
    const changed = ruledWc.some((r, i) => JSON.stringify(r.items) !== JSON.stringify(plainWc[i].items) || r.status !== plainWc[i].status);
    expect(changed).toBe(true);
    // pisarne pravilo WC ne gane (ločeni rule-seti)
    const plainOffice = plain.results.filter((r) => r.room.type === 'office');
    const ruledOffice = ruled.results.filter((r) => r.room.type === 'office');
    expect(JSON.stringify(ruledOffice.map((r) => r.items))).toBe(JSON.stringify(plainOffice.map((r) => r.items)));
  });
});
