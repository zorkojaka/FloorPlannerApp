import type { Rect } from '../engine/geometry';

export interface NoGoZone extends Rect {
  id?: string;
  type?: 'nogo';
}
