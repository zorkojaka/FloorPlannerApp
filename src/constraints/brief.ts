import type { Wall } from '../elements/model';

export interface RoomConfig {
  W: number;
  D: number;
  wetWall: Wall;
  minAisle: number;
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
