import type { RoomType, WcKind } from '../project/roomTypes';

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
  wcKind?: WcKind;
  /** GMP cona (namembnost/čistost) — resnica iz uvoza, če je na voljo */
  zone?: string;
  w: number;
  d: number;
  elements: NormalizedIfcElement[];
}

export interface NormalizedIfcCorridor {
  sourceId: string;
  name: string;
  role: 'main' | 'side';
  width: number;
}

export interface NormalizedIfcPlan {
  sourceId: string;
  name: string;
  corridors?: NormalizedIfcCorridor[];
  rooms: NormalizedIfcRoom[];
}
