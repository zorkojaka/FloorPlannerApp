import type { Envelope } from '../rules/envelope';

export type ConnectionType = 'water-in' | 'water-out' | 'electric' | 'vent';
export type Side = 'back' | 'front' | 'left' | 'right';
export type Wall = 'N' | 'E' | 'S' | 'W';
export type Source = 'default' | 'ifc' | 'user';
export type ElementKind = 'door' | 'window';
export type HumanPosture = 'standing' | 'seated' | 'none';

export interface Connection {
  id: string;
  type: ConnectionType;
  side: Side;
  off: number;
  routesTo: 'wall' | 'floor';
}

export interface Element {
  category: string;
  kind?: ElementKind;
  name: string;
  w: number;
  d: number;
  z: number;
  h: number;
  source: Source;
  conns: Connection[];
  clear: Envelope;
  usage?: {
    posture: HumanPosture;
    userAt: 'front';
  };
  parapet?: number;
}

export interface OrientationResult {
  txt: string;
  warn: boolean;
  corner: boolean;
}

export const CONNECTION_META: Record<ConnectionType, { name: string; short: string; color: string }> = {
  'water-in': { name: 'Dotok vode', short: 'DV', color: '#3f86c9' },
  'water-out': { name: 'Odvod vode', short: 'OV', color: '#16b3b3' },
  electric: { name: 'Elektrika', short: 'EL', color: '#d9a23b' },
  vent: { name: 'Prezračevanje', short: 'PR', color: '#9a86d0' },
};

export const SIDE_LABELS: Record<Side, string> = {
  back: 'zadaj',
  front: 'spredaj',
  left: 'levo',
  right: 'desno',
};

export function isDoor(element: Element | undefined): boolean {
  return element?.kind === 'door';
}

export function isWindow(element: Element | undefined): boolean {
  return element?.kind === 'window';
}

export function serviceSides(element: Element): Side[] {
  const sides = new Set<Side>();
  for (const connection of element.conns) {
    if (connection.routesTo === 'wall') sides.add(connection.side);
  }
  return [...sides];
}

export function orientation(element: Element): OrientationResult {
  const sides = serviceSides(element);
  const isOpposite = (a: Side, b: Side) =>
    (a === 'back' && b === 'front') ||
    (a === 'front' && b === 'back') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left');

  if (sides.length === 0) {
    return { txt: 'Ni priklopa na zid → prost element (otok).', warn: false, corner: false };
  }

  if (sides.length === 1) {
    return {
      txt: `Servisna stran ${SIDE_LABELS[sides[0]]} → ob zidu, 4 orientacije.`,
      warn: false,
      corner: false,
    };
  }

  if (sides.length === 2) {
    return isOpposite(sides[0], sides[1])
      ? { txt: 'Priklopa na NASPROTNIH straneh → fizično nemogoče.', warn: true, corner: false }
      : {
          txt: `Servisni strani ${SIDE_LABELS[sides[0]]}+${SIDE_LABELS[sides[1]]} → v VOGAL, 4 vogali.`,
          warn: false,
          corner: true,
        };
  }

  return { txt: 'Več priklopov na zid → najbrž neizvedljivo.', warn: true, corner: false };
}
