import type { RoomType } from '../project/roomTypes';

export type Facing = 'N' | 'E' | 'S' | 'W';

export interface NormalizedIfcElement {
  sourceId: string;
  name: string;
  elementKey: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h?: number;
  facing: Facing;
}

export interface NormalizedIfcRoom {
  sourceId: string;
  name: string;
  roomType: RoomType;
  w: number;
  d: number;
  elements: NormalizedIfcElement[];
}

export interface NormalizedIfcPlan {
  sourceId: string;
  name: string;
  rooms: NormalizedIfcRoom[];
}
