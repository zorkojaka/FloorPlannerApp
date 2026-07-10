import { describe, expect, it } from 'vitest';
import { planToJson, svgMarkup } from './exportPlan';
import { generateStripFloorLayout } from '../project/floorGenerator';
import { furnishFloorLayout } from '../project/floorFurnish';
import { deriveFloorLayers } from '../project/floorLayers';
import type { ProjectBrief } from '../project/roomTypes';

const BRIEF: ProjectBrief = {
  id: 't', name: 'T', boundary: { area: 200, width: 20, depth: 10 },
  entrances: [{ id: 'e', wall: 'S', position: 0.5, width: 1.2 }],
  corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
  rooms: [
    { id: 'office', type: 'office', count: 3 },
    { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
    { id: 'corridor', type: 'corridor', count: 1 },
  ],
};

describe('planToJson', () => {
  it('sestavi strukturiran načrt s sobami, hodniki in opremo', () => {
    const layout = generateStripFloorLayout(BRIEF);
    const furnishing = furnishFloorLayout(layout, {});
    const plan = planToJson(layout, furnishing, deriveFloorLayers(layout));
    expect(plan.boundary.width).toBe(20);
    expect(plan.rooms.length).toBe(layout.rooms.length);
    expect(plan.rooms[0]).toHaveProperty('doorSide');
    expect(plan.corridors.length).toBeGreaterThan(0);
    expect(Array.isArray(plan.furniture)).toBe(true);
    expect(plan.zoneByRoom).toBeTruthy();
    expect(() => JSON.stringify(plan)).not.toThrow();
  });
});

describe('svgMarkup', () => {
  it('doda xmlns in width/height iz viewBox', () => {
    const out = svgMarkup('<svg viewBox="0 0 22 12"><rect/></svg>', '0 0 22 12');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('width="880"');
    expect(out).toContain('height="480"');
    expect(out.startsWith('<?xml')).toBe(true);
  });
  it('ne podvoji xmlns', () => {
    const out = svgMarkup('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>', '0 0 1 1');
    expect(out.match(/xmlns=/g)).toHaveLength(1);
  });
});
