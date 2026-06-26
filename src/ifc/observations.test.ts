import { describe, expect, it } from 'vitest';
import { observationsFromNormalizedPlan } from './observations';
import type { NormalizedIfcPlan } from './normalizedPlan';

describe('normalized IFC observations', () => {
  it('extracts clearance-front observations from a normalized room fixture', () => {
    const plan: NormalizedIfcPlan = {
      sourceId: 'ifc-demo',
      name: 'Demo IFC export',
      corridors: [
        { sourceId: 'corridor-main', name: 'Main corridor', role: 'main', width: 2100 },
        { sourceId: 'corridor-side', name: 'Side corridor', role: 'side', width: 1300 },
      ],
      rooms: [
        {
          sourceId: 'space-wc-01',
          name: 'WC 01',
          roomType: 'wc',
          w: 1800,
          d: 2200,
          elements: [
            { sourceId: 'toilet-01', name: 'Toilet', elementKey: 'toilet', x: 700, y: 250, w: 400, d: 600, facing: 'N' },
            { sourceId: 'sink-01', name: 'Sink', elementKey: 'sink', x: 100, y: 900, w: 550, d: 430, facing: 'E' },
          ],
        },
      ],
    };

    expect(observationsFromNormalizedPlan(plan)).toEqual([
      {
        ref: 'ifc-demo:corridor-main:corridor-width',
        roomType: 'corridor',
        scope: 'room-type',
        elementKey: 'corridor',
        parameter: 'corridor-width-main',
        value: 2100,
        note: 'Extracted main corridor width from normalized IFC plan Demo IFC export',
      },
      {
        ref: 'ifc-demo:corridor-side:corridor-width',
        roomType: 'corridor',
        scope: 'room-type',
        elementKey: 'corridor',
        parameter: 'corridor-width-side',
        value: 1300,
        note: 'Extracted side corridor width from normalized IFC plan Demo IFC export',
      },
      {
        ref: 'ifc-demo:space-wc-01:toilet-01:clearance-front',
        roomType: 'wc',
        scope: 'room-type',
        elementKey: 'toilet',
        parameter: 'clearance-front',
        value: 1350,
        note: 'Extracted from normalized IFC room WC 01',
      },
      {
        ref: 'ifc-demo:space-wc-01:sink-01:clearance-front',
        roomType: 'wc',
        scope: 'room-type',
        elementKey: 'sink',
        parameter: 'clearance-front',
        value: 1150,
        note: 'Extracted from normalized IFC room WC 01',
      },
    ]);
  });
});
