import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool, generateStripFloorLayout } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

describe('project floor generator', () => {
  const brief: ProjectBrief = {
    id: 'demo-floor',
    name: 'Demo floor',
      boundary: { area: 80, width: 10, depth: 8 },
      corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
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
    expect(layout.corridor.d).toBe(1.8);
    expect(layout.rooms.map((room) => room.type)).toEqual(['wc', 'office', 'office']);
    expect(layout.rooms.some((room) => room.y < layout.corridor.y)).toBe(true);
    expect(layout.rooms.some((room) => room.y > layout.corridor.y)).toBe(true);
    expect(layout.rooms.every((room) => room.doorToCorridor)).toBe(true);
    expect(layout.fitsBoundary).toBe(true);
    expect(layout.warnings).toEqual([]);
  });

  it('distributes many offices on both sides of the corridor instead of one thin strip', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      boundary: { area: 150, width: 40, depth: 12.5 },
      rooms: [
        { id: 'wc', type: 'wc', count: 3 },
        { id: 'office', type: 'office', count: 20, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    expect(layout.rooms.filter((room) => room.type === 'office')).toHaveLength(20);
    expect(layout.rooms.some((room) => room.y < layout.corridor.y)).toBe(true);
    expect(layout.rooms.some((room) => room.y > layout.corridor.y)).toBe(true);
    const usedArea = layout.corridor.area + layout.rooms.reduce((sum, room) => sum + room.area, 0);
    expect(usedArea / layout.boundary.area).toBeGreaterThan(0.9);
  });

  it('reports frontage overflow instead of hiding an impossible layout', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      boundary: { area: 35, width: 4, depth: 8 },
    });
    expect(layout.fitsBoundary).toBe(false);
    expect(layout.warnings).toContain('Rooms exceed available frontage along the corridor.');
  });

  it('generates multiple deterministic floor candidates for A/B selection', () => {
    const pool = generateFloorLayoutPool(brief);
    expect(pool.length).toBeGreaterThan(4);
    expect(new Set(pool.map((layout) => layout.id)).size).toBe(pool.length);
    expect(pool.some((layout) => layout.corridor.y > 0)).toBe(true);
    expect(pool.some((layout) => layout.variant.includes('center-cross'))).toBe(true);
  });

  it('offers variants with wc rooms dispersed among offices', () => {
    const pool = generateFloorLayoutPool({
      ...brief,
      boundary: { area: 1600, width: 40, depth: 40 },
      rooms: [
        { id: 'wc', type: 'wc', count: 4 },
        { id: 'office', type: 'office', count: 12, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    const spread = pool.find((layout) => layout.variant.startsWith('spread-wc'));
    expect(spread).toBeTruthy();
    const wcIndexes = spread!.rooms.map((room, index) => room.type === 'wc' ? index : -1).filter((index) => index >= 0);
    expect(Math.max(...wcIndexes) - Math.min(...wcIndexes)).toBeGreaterThan(4);
  });

  it('keeps male and female wc programs as separate placed rooms', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      rooms: [
        { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
        { id: 'wc-women', type: 'wc', wcKind: 'female', count: 1 },
        { id: 'office', type: 'office', count: 1, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    expect(layout.rooms.filter((room) => room.type === 'wc').map((room) => [room.name, room.wcKind])).toEqual([
      ['Moški WC', 'male'],
      ['Ženski WC', 'female'],
    ]);
  });

  it('routes the main corridor from the first floor entrance and keeps all entrances', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      entrances: [
        { id: 'west-main', wall: 'W', position: 0.5, width: 1.4 },
        { id: 'east-service', wall: 'E', position: 0.2, width: 1.1 },
        { id: 'south-extra', wall: 'S', position: 0.8, width: 1.0 },
      ],
    });
    expect(layout.corridor.x).toBeGreaterThan(0);
    expect(layout.corridor.w).toBe(1.8);
    expect(layout.corridor.d).toBe(8);
    expect(layout.corridorLinks).toHaveLength(3);
    expect(layout.corridorLinks.every((link) => Math.abs(link.d - 1.2) < 0.01 || Math.abs(link.w - 1.2) < 0.01)).toBe(true);
    expect(layout.corridorLinks.every((link) => link.type === 'corridor')).toBe(true);
    expect(layout.entrances.map((entry) => entry.id)).toEqual(['west-main', 'east-service', 'south-extra']);
  });
});
