import type { Wall } from '../elements/model';
import type { NoGoZone } from './zones';

export interface RoomConfig {
  W: number;
  D: number;
  wetWall: Wall;
  minAisle: number;
}

/**
 * Strukturiran nabor omejitev za ENO sobo (korak 2 workflowa, Nadgradnja 4.0).
 * To je hkrati vmesnik, ki ga kasneje napolni engine za razporeditev sob
 * (oreh 2): ista pot noter, drug vir (zdaj uporabnik, kasneje zgornji engine).
 */
export interface RoomConstraints {
  W: number;
  D: number;
  wetWall: Wall;
  extWall: Wall; // zunanji zid (okna, prezračevanje)
  minAisle: number;
  doors: ProgramInstance[];
  fixtures: ProgramInstance[];
  zones: NoGoZone[];
  routingPolicy: { floorAllowed: boolean };
}

/** Razčleni per-soba omejitve na vhode, ki jih razume generator. */
export function fromRoomConstraints(rc: RoomConstraints): {
  cfg: RoomConfig;
  program: ProgramInstance[];
  zones: NoGoZone[];
  routingPolicy: { floorAllowed: boolean };
} {
  return {
    cfg: { W: rc.W, D: rc.D, wetWall: rc.wetWall, minAisle: rc.minAisle },
    program: [...rc.doors, ...rc.fixtures],
    zones: rc.zones,
    routingPolicy: rc.routingPolicy,
  };
}

export interface ProgramInstance {
  id: string;
  key: string;
  w?: number;
  dir?: 'auto' | 'inward' | 'outward';
  hinge?: 'auto' | 0 | 1;
  wall?: 'auto' | Wall;
  fixedPos?: boolean;
  fpos?: number;
}
