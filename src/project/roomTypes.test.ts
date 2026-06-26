import { describe, expect, it } from 'vitest';
import { estimateProjectArea, estimateRoomProgramArea, validateProjectBrief, type ProjectBrief } from './roomTypes';

describe('project room type model', () => {
  const brief: ProjectBrief = {
    id: 'demo',
    name: 'WC + offices prototype',
    boundary: { area: 80, width: 10, depth: 8 },
    rooms: [
      { id: 'wc-1', type: 'wc', count: 1 },
      { id: 'office-1', type: 'office', count: 2, workstations: 1 },
      { id: 'corridor', type: 'corridor', count: 1 },
    ],
  };

  it('estimates office and wc area before floor generation exists', () => {
    expect(estimateRoomProgramArea({ id: 'wc', type: 'wc', count: 1 })).toBe(3.2);
    expect(estimateRoomProgramArea({ id: 'office', type: 'office', count: 2, workstations: 1 })).toBe(20);
  });

  it('adds a corridor allowance and reports whether the program fits the boundary', () => {
    const summary = estimateProjectArea(brief);
    expect(summary.roomArea).toBeCloseTo(23.2);
    expect(summary.corridorArea).toBeCloseTo(4.176);
    expect(summary.totalArea).toBeCloseTo(27.376);
    expect(summary.fitsBoundary).toBe(true);
    expect(summary.remainingArea).toBeGreaterThan(52);
  });

  it('uses explicit corridor area when provided', () => {
    const summary = estimateProjectArea({
      ...brief,
      rooms: [...brief.rooms.filter((room) => room.type !== 'corridor'), { id: 'corridor', type: 'corridor', count: 1, areaOverride: 12 }],
    });
    expect(summary.corridorArea).toBe(12);
    expect(summary.totalArea).toBeCloseTo(35.2);
  });

  it('validates boundary and room counts', () => {
    expect(validateProjectBrief(brief)).toEqual([]);
    expect(validateProjectBrief({ ...brief, boundary: { area: 0 }, rooms: [{ id: 'bad', type: 'wc', count: -1 }] })).toEqual([
      'Project boundary area must be positive.',
      'Room bad count must be a non-negative integer.',
    ]);
  });
});
