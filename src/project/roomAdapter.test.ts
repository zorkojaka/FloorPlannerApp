import { describe, expect, it } from 'vitest';
import { roomConstraintsFromPlacedRoom } from './roomAdapter';
import type { PlacedRoom } from './floorGenerator';

describe('project room adapter', () => {
  it('converts a placed wc room into current room-engine constraints', () => {
    const room: PlacedRoom = { id: 'wc-1', programId: 'wc', type: 'wc', name: 'WC', x: 0, y: 1.4, w: 1.8, d: 2.4, area: 4.32, doorToCorridor: true };
    const constraints = roomConstraintsFromPlacedRoom(room);
    expect(constraints.W).toBe(1800);
    expect(constraints.D).toBe(2400);
    expect(constraints.doors[0].key).toBe('door');
    expect(constraints.fixtures.map((fixture) => fixture.key)).toEqual(['toilet', 'sink']);
    expect(constraints.routingPolicy.floorAllowed).toBe(true);
  });

  it('adds urinal to male wc rooms', () => {
    const room: PlacedRoom = { id: 'wc-men-1', programId: 'wc-men', type: 'wc', wcKind: 'male', name: 'Moški WC', x: 0, y: 1.4, w: 2, d: 2.4, area: 4.8, doorToCorridor: true };
    const constraints = roomConstraintsFromPlacedRoom(room);
    expect(constraints.fixtures.map((fixture) => fixture.key)).toEqual(['toilet', 'urinal', 'sink']);
  });

  it('converts a placed office room into desk, chair and cabinet program', () => {
    const room: PlacedRoom = { id: 'office-1', programId: 'office', type: 'office', name: 'Pisarna', x: 1.8, y: 1.4, w: 3.2, d: 3.5, area: 11.2, doorToCorridor: true };
    const constraints = roomConstraintsFromPlacedRoom(room);
    expect(constraints.W).toBe(3200);
    expect(constraints.D).toBe(3500);
    expect(constraints.fixtures.map((fixture) => fixture.key)).toEqual(['desk', 'chair', 'cabinet']);
    expect(constraints.routingPolicy.floorAllowed).toBe(false);
  });
});
