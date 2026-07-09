import { describe, expect, it } from 'vitest';
import { generateFloorLayoutPool, generateStripFloorLayout, type FloorLayout, type PlacedRoom } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

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

function corridorsOf(layout: FloorLayout): PlacedRoom[] {
  return [layout.corridor, ...layout.corridorLinks];
}

function overlaps(a: PlacedRoom, b: PlacedRoom): boolean {
  return a.x < b.x + b.w - 0.05 && a.x + a.w > b.x + 0.05 && a.y < b.y + b.d - 0.05 && a.y + a.d > b.y + 0.05;
}

describe('project floor generator', () => {
  it('places every room adjacent to a corridor with a door on the touching side', () => {
    const layout = generateStripFloorLayout(brief);
    expect(layout.corridor.type).toBe('corridor');
    expect(layout.rooms.map((room) => room.type).sort()).toEqual(['office', 'office', 'wc']);
    // vsaka soba ima vrata na rob, ki se dotika hodnika
    expect(layout.rooms.every((room) => room.doorToCorridor && room.doorSide)).toBe(true);
    // nobena soba se ne prekriva s hodnikom (hodnik zaseda svoj prostor)
    const corridors = corridorsOf(layout);
    expect(layout.rooms.every((room) => !corridors.some((c) => overlaps(room, c)))).toBe(true);
    expect(layout.fitsBoundary).toBe(true);
    expect(layout.warnings).toEqual([]);
  });

  it('adds parallel corridors for deep floors instead of over-deep rooms', () => {
    const shallow = generateStripFloorLayout({ ...brief, boundary: { area: 100, width: 20, depth: 5 } });
    const deep = generateStripFloorLayout({
      ...brief,
      boundary: { area: 600, width: 20, depth: 30 },
      rooms: [
        { id: 'office', type: 'office', count: 24, workstations: 1 },
        { id: 'wc', type: 'wc', count: 2 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    const shallowRungs = corridorsOf(shallow).filter((c) => c.id.startsWith('corridor-main')).length;
    const deepRungs = corridorsOf(deep).filter((c) => c.id.startsWith('corridor-main')).length;
    expect(deepRungs).toBeGreaterThan(shallowRungs);
    // globoka etaža ne dela pregloboke sobe
    expect(deep.rooms.every((room) => Math.min(room.w, room.d) <= 6.5)).toBe(true);
    expect(deep.rooms.every((room) => room.doorSide)).toBe(true);
  });

  it('carves a perpendicular connector that links the corridors', () => {
    const layout = generateStripFloorLayout(brief);
    const connector = layout.corridorLinks.find((c) => c.id === 'corridor-connector');
    expect(connector).toBeTruthy();
    // sobe se izognejo konektorju
    expect(layout.rooms.every((room) => !overlaps(room, connector!))).toBe(true);
  });

  it('reports frontage overflow instead of hiding an impossible layout', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      boundary: { area: 35, width: 4, depth: 8 },
      rooms: [
        { id: 'office', type: 'office', count: 8, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    expect(layout.fitsBoundary).toBe(false);
    expect(layout.warnings).toContain('Rooms exceed available frontage along the corridor.');
  });

  it('generates multiple deterministic floor candidates for A/B selection', () => {
    const pool = generateFloorLayoutPool(brief);
    expect(pool.length).toBeGreaterThan(4);
    expect(new Set(pool.map((layout) => layout.id)).size).toBe(pool.length);
    expect(pool.every((layout) => layout.rooms.every((room) => room.doorSide))).toBe(true);
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
  });

  it('keeps male and female wc programs as separate placed rooms with a minimum dimension', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      rooms: [
        { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
        { id: 'wc-women', type: 'wc', wcKind: 'female', count: 1 },
        { id: 'office', type: 'office', count: 1, workstations: 1 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    });
    const wcs = layout.rooms.filter((room) => room.type === 'wc');
    expect(wcs.map((room) => room.wcKind).sort()).toEqual(['female', 'male']);
    expect(wcs.every((room) => room.w >= 2.4 || room.d >= 2.4)).toBe(true);
  });

  it('window-aware placement gives offices a facade window in deep floors', () => {
    const deepBrief: ProjectBrief = {
      ...brief,
      boundary: { area: 720, width: 30, depth: 24 },
      rooms: [
        { id: 'office', type: 'office', count: 20, workstations: 1 },
        { id: 'wc-men', type: 'wc', wcKind: 'male', count: 2 },
        { id: 'wc-women', type: 'wc', wcKind: 'female', count: 2 },
        { id: 'corridor', type: 'corridor', count: 1 },
      ],
    };
    const officeWindows = (layout: FloorLayout) => {
      const offices = layout.rooms.filter((room) => room.type === 'office');
      return offices.filter((room) => room.hasWindow).length / offices.length;
    };
    const plain = generateStripFloorLayout(deepBrief, { windowAware: false });
    const windowed = generateStripFloorLayout(deepBrief, { windowAware: true });
    // globoka etaža ima notranje vrste → brez oken; okenska razporeditev pisarne potisne na fasado
    expect(windowed.corridorLinks.filter((c) => c.id.startsWith('corridor-main')).length).toBeGreaterThan(0);
    expect(officeWindows(windowed)).toBeGreaterThan(officeWindows(plain));
    expect(windowed.rooms.every((room) => room.hasWindow !== undefined)).toBe(true);
  });

  it('keeps all entrances and orients the corridor from the first entrance', () => {
    const layout = generateStripFloorLayout({
      ...brief,
      entrances: [
        { id: 'west-main', wall: 'W', position: 0.5, width: 1.4 },
        { id: 'east-service', wall: 'E', position: 0.2, width: 1.1 },
        { id: 'south-extra', wall: 'S', position: 0.8, width: 1.0 },
      ],
    });
    // vhod na zahodu → navpičen hodnik
    expect(layout.corridor.d).toBeGreaterThan(layout.corridor.w);
    expect(layout.entrances.map((entry) => entry.id)).toEqual(['west-main', 'east-service', 'south-extra']);
  });
});
