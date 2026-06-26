import type { ProgramInstance, RoomConstraints } from '../constraints/brief';
import type { PlacedRoom } from './floorGenerator';

export function roomConstraintsFromPlacedRoom(room: PlacedRoom): RoomConstraints {
  const doors: ProgramInstance[] = [{ id: `${room.id}-door`, key: 'door', w: 800, dir: 'auto', wall: 'S', hinge: 'auto' }];
  return {
    W: Math.round(room.w * 1000),
    D: Math.round(room.d * 1000),
    wetWall: 'S',
    extWall: 'N',
    minAisle: room.type === 'corridor' ? 1200 : 800,
    doors,
    fixtures: fixturesForRoom(room),
    zones: [],
    routingPolicy: { floorAllowed: room.type === 'wc' },
  };
}

function fixturesForRoom(room: PlacedRoom): ProgramInstance[] {
  if (room.type === 'wc' && room.wcKind === 'male') return [
    { id: `${room.id}-toilet`, key: 'toilet' },
    { id: `${room.id}-urinal`, key: 'urinal' },
    { id: `${room.id}-sink`, key: 'sink' },
  ];
  if (room.type === 'wc') return [
    { id: `${room.id}-toilet`, key: 'toilet' },
    { id: `${room.id}-sink`, key: 'sink' },
  ];
  if (room.type === 'office') return [
    { id: `${room.id}-desk`, key: 'desk' },
    { id: `${room.id}-chair`, key: 'chair' },
    { id: `${room.id}-cabinet`, key: 'cabinet' },
  ];
  return [];
}
