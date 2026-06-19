import type { Envelope } from '../rules/envelope';

export type ConnectionType = 'water-in' | 'water-out' | 'electric' | 'vent';
export type Side = 'back' | 'front' | 'left' | 'right';
export type Wall = 'N' | 'E' | 'S' | 'W';
export type Source = 'default' | 'ifc' | 'user';
export type ElementKind = 'door' | 'window';
export type HumanPosture = 'standing' | 'seated' | 'none';

// Medij priklopa = `type` (voda-odvod / voda-dovod / elektrika / zrak). `z` je
// višina priklopa nad tlemi (mm); če ni nastavljena, privzeto na sredini višine
// elementa (glej connectionZ).
export interface Connection {
  id: string;
  type: ConnectionType;
  side: Side;
  off: number;
  routesTo: 'wall' | 'floor';
  z?: number;
}

// Profil trasiranja medija — FIZIKA, trd in global, se NE uči.
// ODLOŽENO (regulirana domena): polni naklonski model gravitacijskega odvoda
// (troši višino: dolžina × naklon, omejena dolžina jaška) — tu le poenostavljeno.
export interface MediaProfile {
  label: string; // slovenski naziv medija
  gravity: boolean; // rabi padec (gravitacijski) → ne sme čez odprtino vrat
  mayCrossObstacles: boolean; // tlačni/elektrika/zrak smejo čez ovire
  rule: string; // pravilo za prikaz (steklena škatla) že pri urejanju
}

export const MEDIA_PROFILE: Record<ConnectionType, MediaProfile> = {
  'water-out': {
    label: 'voda-odvod',
    gravity: true,
    mayCrossObstacles: false,
    rule: 'Gravitacijski odvod: mora padati navzdol; NE čez odprtino vrat/prag; rabi vertikalo (jašek) v dosegu.',
  },
  'water-in': {
    label: 'voda-dovod',
    gravity: false,
    mayCrossObstacles: true,
    rule: 'Tlačni dovod: prosta pot, brez padca; sme čez ovire.',
  },
  electric: {
    label: 'elektrika',
    gravity: false,
    mayCrossObstacles: true,
    rule: 'Elektrika: skoraj prosta pot.',
  },
  vent: {
    label: 'zrak',
    gravity: false,
    mayCrossObstacles: true,
    rule: 'Zrak: prosta pot, a večji presek (polni model odložen).',
  },
};

// Višina priklopa: nastavljiva (connection.z) ali privzeto sredina višine elementa.
export function connectionZ(element: Element, connection: Connection): number {
  return connection.z ?? (element.z ?? 0) + (element.h ?? 0) / 2;
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
