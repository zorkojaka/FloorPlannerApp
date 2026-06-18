import type { Element } from './model';
import { uid } from '../shared/math';

export type ElementLibrary = Record<string, Element>;

export function baseLib(): ElementLibrary {
  return {
    toilet: {
      category: 'toilet',
      name: 'WC skoljka',
      w: 400,
      d: 600,
      source: 'default',
      conns: [
        { id: uid(), type: 'water-out', side: 'back', off: 0.5, routesTo: 'floor' },
        { id: uid(), type: 'water-in', side: 'back', off: 0.25, routesTo: 'wall' },
      ],
      clear: { core: 650, halo: 800, sat: 1000, conf: 0.92, scope: 'room-type' },
    },
    sink: {
      category: 'sink',
      name: 'Umivalnik',
      w: 550,
      d: 430,
      source: 'default',
      conns: [
        { id: uid(), type: 'water-out', side: 'back', off: 0.55, routesTo: 'wall' },
        { id: uid(), type: 'water-in', side: 'back', off: 0.4, routesTo: 'wall' },
      ],
      clear: { core: 550, halo: 700, sat: 900, conf: 0.85, scope: 'global' },
    },
    urinal: {
      category: 'urinal',
      name: 'Pisoar',
      w: 400,
      d: 350,
      source: 'default',
      conns: [
        { id: uid(), type: 'water-out', side: 'back', off: 0.5, routesTo: 'wall' },
        { id: uid(), type: 'water-in', side: 'back', off: 0.5, routesTo: 'wall' },
      ],
      clear: { core: 600, halo: 750, sat: 900, conf: 0.8, scope: 'room-type' },
    },
    door: {
      category: 'door',
      kind: 'door',
      name: 'Vrata',
      w: 800,
      d: 80,
      source: 'default',
      conns: [],
      clear: { core: 0, halo: 0, sat: 0, conf: 1, scope: 'global' },
    },
  };
}
