import { describe, expect, it } from 'vitest';
import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import {
  addReference,
  floorTrainingFromLibrary,
  inferReferenceKind,
  initialReferenceLibrary,
  normalizeReferenceLibrary,
  referencesOfKind,
  referenceSummary,
  removeReference,
} from './referenceLibrary';

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
