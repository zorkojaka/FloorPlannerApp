import { describe, expect, it } from 'vitest';
import { generateStripFloorLayout } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

describe('project floor generator', () => {
  const brief: ProjectBrief = {
    id: 'demo-floor',
    name: 'Demo floor',
    boundary: { area: 80, width: 10, depth: 8 },
    rooms: [
      { id: 'wc', type: 'wc', count: 1 },
      { id: 'office', type: 'office', count: 2, workstations: 1 },
      { id: 'corridor', type: 'corridor', count: 1 },
    ],
  };

  it('places wc, offices and a corridor inside a simple boundary', () => {
    const layout = generateStripFloorLayout(brief);
    expect(layout.corridor.type).toBe('corridor');
    expect(layout.corridor.w).toBe(10);
    expect(layout.corridor.d).toBe(1.4);
    expect(layout.rooms.map((room) => room.type)).toEqual(['wc', 'office', 'office']);
    expect(layout.rooms.every((room) => room.doorToCorridor)).toBe(true);
    expect(layout.fitsBoundary).toBe(true);
    expect(layout.warnings).toEqual([]);
  });

  it('reports frontage overflow instead of hiding an impossible layout', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      boundary: { area: 35, width: 4, depth: 8 },
    });
    expect(layout.fitsBoundary).toBe(false);
    expect(layout.warnings).toContain('Rooms exceed available frontage along the corridor.');
  });
});
