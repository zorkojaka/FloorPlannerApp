import { describe, it, expect } from 'vitest';
import { generateStripFloorLayout } from './floorGenerator';
import { deriveFloorLayers, roomZone } from './floorLayers';
import type { ProjectBrief } from './roomTypes';

const BRIEF: ProjectBrief = {
  id: 'test',
  name: 'Test',
  boundary: { area: 120, width: 14, depth: 8.6 },
  entrances: [{ id: 'e1', wall: 'S', position: 0.5, width: 1.2 }],
  corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
  rooms: [
    { id: 'office', type: 'office', count: 3, workstations: 1 },
    { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
    { id: 'corridor', type: 'corridor', count: 1 },
  ],
};

describe('roomZone', () => {
  it('izpelje cono iz tipa', () => {
    expect(roomZone({ type: 'office' } as any)).toBe('work');
    expect(roomZone({ type: 'wc' } as any)).toBe('sanitary');
    expect(roomZone({ type: 'corridor' } as any)).toBe('circulation');
  });
  it('spoštuje eksplicitno cono', () => {
    expect(roomZone({ type: 'office', zone: 'technical' } as any)).toBe('technical');
  });
});

describe('deriveFloorLayers', () => {
  it('vrne cone za vse prostore in tokove ljudje/material/odpadki', () => {
    const layout = generateStripFloorLayout(BRIEF, {});
    const layers = deriveFloorLayers(layout);
    const allRooms = [...layout.rooms, layout.corridor, ...(layout.corridorLinks || [])];
    for (const room of allRooms) expect(layers.zoneByRoom[room.id]).toBeTruthy();
    const kinds = layers.flows.map((flow) => flow.kind);
    expect(kinds).toContain('people');
    expect(kinds).toContain('material');
    expect(kinds).toContain('waste');
    const people = layers.flows.find((flow) => flow.kind === 'people')!;
    // hrbtenica (osi hodnikov) + vhodni krak + kraki na prostore
    expect(people.polylines.length).toBeGreaterThanOrEqual(2);
    for (const flow of layers.flows) for (const pl of flow.polylines) expect(pl.length).toBeGreaterThanOrEqual(2);
    // odpadki dosežejo rob etaže (izhod)
    const waste = layers.flows.find((flow) => flow.kind === 'waste')!;
    const exit = waste.polylines[waste.polylines.length - 1].at(-1)!;
    const D = layout.boundary.depth;
    const W = layout.boundary.width;
    expect(exit.y === 0 || exit.y === D || exit.x === 0 || exit.x === W).toBe(true);
  });
});
