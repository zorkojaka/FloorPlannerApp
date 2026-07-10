import type { RoomConfig } from '../constraints/brief';
import type { LayoutCandidate } from '../engine/generator';
import { defaultChannels, learnChannelsFromPreference, type Channel } from '../engine/channels';
import type { RoomType } from './roomTypes';

// Preference pohištva se učijo PER TIP SOBE, ne per soba: izbira v eni pisarni
// izboljša postavitve v vseh pisarnah. Stanje je navaden JSON (localStorage zdaj,
// backend kasneje), kanali so obstoječi sobni kanali (engine/channels.ts).

export interface RoomTypePrefState {
  channels: Channel[];
  comparisons: number;
  /** velikosti zadnjih sprememb naučenih uteži (za zaznavo umiritve) */
  lastDeltas: number[];
  converged: boolean;
}

export type RoomTypePrefs = Record<string, RoomTypePrefState>;

const CONVERGE_MIN_COMPARISONS = 5;
const CONVERGE_STREAK = 4;
const CONVERGE_EPS = 0.01;
const DELTA_HISTORY = 6;

export function initialRoomTypePrefs(): RoomTypePrefs {
  return {};
}

function initialState(): RoomTypePrefState {
  return { channels: defaultChannels(), comparisons: 0, lastDeltas: [], converged: false };
}

/** Stanje za tip sobe; manjkajoče/star zapis dopolni s privzetimi kanali. */
export function prefStateForType(prefs: RoomTypePrefs | null | undefined, type: RoomType | string): RoomTypePrefState {
  const raw = prefs?.[type];
  if (!raw) return initialState();
  const defaults = defaultChannels();
  const byId = new Map((raw.channels || []).map((channel) => [channel.id, channel]));
  return {
    channels: defaults.map((channel) => ({ ...channel, ...(byId.get(channel.id) || {}) })),
    comparisons: raw.comparisons ?? 0,
    lastDeltas: Array.isArray(raw.lastDeltas) ? raw.lastDeltas.slice(-DELTA_HISTORY) : [],
    converged: raw.converged ?? false,
  };
}

export function channelsForType(prefs: RoomTypePrefs | null | undefined, type: RoomType | string): Channel[] {
  return prefStateForType(prefs, type).channels;
}

/** Zabeleži A/B izbiro pohištva za tip sobe: kanali se naučijo, konvergenca se preveri. */
export function recordRoomTypePreference(
  prefs: RoomTypePrefs,
  type: RoomType | string,
  selected: LayoutCandidate,
  rejected: LayoutCandidate,
  cfg: RoomConfig,
): RoomTypePrefs {
  const state = prefStateForType(prefs, type);
  const channels = learnChannelsFromPreference(state.channels, selected, rejected, cfg);
  const delta = channels.reduce((sum, channel, i) => sum + Math.abs(channel.learned - state.channels[i].learned), 0);
  const lastDeltas = [...state.lastDeltas, delta].slice(-DELTA_HISTORY);
  const comparisons = state.comparisons + 1;
  return {
    ...prefs,
    [type]: { channels, comparisons, lastDeltas, converged: isSettled(comparisons, lastDeltas) },
  };
}

/** "Enakovredni": uteži mirujejo, a primerjava šteje k umiritvi. */
export function recordRoomTypeEquivalence(prefs: RoomTypePrefs, type: RoomType | string): RoomTypePrefs {
  const state = prefStateForType(prefs, type);
  const lastDeltas = [...state.lastDeltas, 0].slice(-DELTA_HISTORY);
  const comparisons = state.comparisons + 1;
  return {
    ...prefs,
    [type]: { ...state, comparisons, lastDeltas, converged: isSettled(comparisons, lastDeltas) },
  };
}

function isSettled(comparisons: number, lastDeltas: number[]): boolean {
  if (comparisons < CONVERGE_MIN_COMPARISONS) return false;
  const recent = lastDeltas.slice(-CONVERGE_STREAK);
  return recent.length >= CONVERGE_STREAK && recent.every((delta) => delta < CONVERGE_EPS);
}
