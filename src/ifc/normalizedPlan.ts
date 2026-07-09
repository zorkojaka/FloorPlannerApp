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

/** Normaliziran okvir (0..1 glede na sliko) — za verifikacijski overlay ob AI-ekstrakciji. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  /** lega na izvorni sliki (0..1) — samo za verifikacijski prikaz, ne za indukcijo */
  bbox?: BBox;
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
