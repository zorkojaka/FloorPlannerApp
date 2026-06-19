import type { LayoutCandidate } from './generator';
import type { RoomConfig } from '../constraints/brief';
import type { PlacedDoor, PlacedFixture } from './evaluator';
import type { Box3D } from './volume';
import { distanceToWall } from './geometry';
import { elementBox, humanUsageBox } from './volume';
import { buildFreeGrid, corridorWidth, findPath } from './freespace';
import { doorInteriorPoint, usagePoint } from './evaluator';

export type ChannelFamily = 'distance' | 'relational' | 'topology' | 'distribution' | 'alignment';
export type ChannelScope = 'global' | 'room-type';

export interface Channel {
  id: string;
  name: string;
  family: ChannelFamily;
  scope: ChannelScope;
  enabled: boolean;
  prior: number;
  learned: number;
  confidence: number;
}

export interface ChannelScore {
  channelId: string;
  value: number;
  effectiveWeight: number;
  weighted: number;
}

export interface ChannelScoreResult {
  total: number;
  scores: ChannelScore[];
}

export function defaultChannels(): Channel[] {
  return [
    {
      id: 'drain-distance',
      name: 'Kratke instalacijske trase',
      family: 'distance',
      scope: 'room-type',
      enabled: true,
      prior: 0.42,
      learned: 0.42,
      confidence: 0.7,
    },
    {
      id: 'same-category-cluster',
      name: 'Gručenje istovrstnih',
      family: 'relational',
      scope: 'room-type',
      enabled: true,
      prior: 0.28,
      learned: 0.28,
      confidence: 0.45,
    },
    {
      id: 'space-distribution',
      name: 'Izraba prostora',
      family: 'distribution',
      scope: 'global',
      enabled: true,
      prior: 0.3,
      learned: 0.3,
      confidence: 0.55,
    },
    {
      id: 'passing-while-used',
      name: 'Mimohod med uporabo',
      family: 'topology',
      scope: 'global',
      enabled: true,
      prior: 0.16,
      learned: 0.16,
      confidence: 0.35,
    },
    {
      id: 'daylight-access',
      name: 'Dostop do svetlobe',
      family: 'distance',
      scope: 'room-type',
      enabled: true,
      prior: 0.12,
      learned: 0.12,
      confidence: 0.45,
    },
    {
      id: 'path-comfort',
      name: 'Udobje poti (želena širina)',
      family: 'topology',
      scope: 'room-type',
      enabled: true,
      prior: 0.18,
      learned: 0.18,
      confidence: 0.4,
    },
  ];
}

export function effectiveWeight(channel: Channel): number {
  return channel.prior * channel.confidence + channel.learned * (1 - channel.confidence);
}

export function scoreCandidateChannels(candidate: LayoutCandidate, channels: Channel[], cfg: RoomConfig): ChannelScoreResult {
  const enabled = channels.filter((channel) => channel.enabled);
  if (enabled.length === 0) return { total: candidate.ev.score, scores: [] };

  const scores = enabled.map((channel) => {
    const value = measureChannel(channel.id, candidate, cfg);
    const weight = effectiveWeight(channel);
    return { channelId: channel.id, value, effectiveWeight: weight, weighted: value * weight };
  });
  const weightSum = scores.reduce((sum, score) => sum + score.effectiveWeight, 0) || 1;
  const total = scores.reduce((sum, score) => sum + score.weighted, 0) / weightSum;
  return { total, scores };
}

export function rankByChannels(candidates: LayoutCandidate[], channels: Channel[], cfg: RoomConfig): LayoutCandidate[] {
  // oceni vsakega kandidata ENKRAT (path-comfort je dražji: mreža + A*), nato sortiraj
  const scored = candidates.map((candidate) => ({ candidate, total: scoreCandidateChannels(candidate, channels, cfg).total }));
  scored.sort((a, b) => b.total - a.total);
  return scored.map((entry) => entry.candidate);
}

export function learnChannelsFromPreference(channels: Channel[], selected: LayoutCandidate, rejected: LayoutCandidate, cfg: RoomConfig): Channel[] {
  return normalizeLearned(
    channels.map((channel) => {
      if (!channel.enabled) return channel;
      const selectedValue = measureChannel(channel.id, selected, cfg);
      const rejectedValue = measureChannel(channel.id, rejected, cfg);
      const delta = selectedValue - rejectedValue;
      if (Math.abs(delta) < 0.03) return channel;
      return { ...channel, learned: clamp01(channel.learned + delta * 0.08) };
    }),
  );
}

export function measureChannel(channelId: string, candidate: LayoutCandidate, cfg: RoomConfig): number {
  if (channelId === 'drain-distance') return measureDrainDistance(candidate, cfg);
  if (channelId === 'same-category-cluster') return measureSameCategoryCluster(candidate, cfg);
  if (channelId === 'space-distribution') return measureSpaceDistribution(candidate, cfg);
  if (channelId === 'passing-while-used') return measurePassingWhileUsed(candidate, cfg);
  if (channelId === 'daylight-access') return measureDaylightAccess(candidate, cfg);
  if (channelId === 'path-comfort') return measurePathComfort(candidate, cfg);
  return candidate.ev.score;
}

function fixtures(candidate: LayoutCandidate): PlacedFixture[] {
  return candidate.placed.filter((item): item is PlacedFixture => item.kind !== 'door');
}

function measureDrainDistance(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const items = fixtures(candidate);
  if (items.length === 0) return 1 - Math.min(1, candidate.ev.drain / Math.max(cfg.W, cfg.D));
  const total = items.reduce((sum, item) => {
    const center = { x: item.foot.x + item.foot.w / 2, y: item.foot.y + item.foot.h / 2 };
    return sum + distanceToWall(center.x, center.y, cfg.wetWall, cfg.W, cfg.D);
  }, 0);
  return 1 - Math.min(1, total / (items.length * Math.max(cfg.W, cfg.D)));
}

function measureSameCategoryCluster(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const byCategory = new Map<string, PlacedFixture[]>();
  for (const item of fixtures(candidate)) {
    byCategory.set(item.el.category, [...(byCategory.get(item.el.category) || []), item]);
  }

  const distances: number[] = [];
  for (const group of byCategory.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        distances.push(centerDistance(group[i], group[j]));
      }
    }
  }

  if (distances.length === 0) return 1;
  const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  return 1 - Math.min(1, average / Math.hypot(cfg.W, cfg.D));
}

function measureSpaceDistribution(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const items = fixtures(candidate);
  if (items.length === 0) return 1;
  const roomCenter = { x: cfg.W / 2, y: cfg.D / 2 };
  const weighted = items.reduce(
    (acc, item) => {
      const area = item.foot.w * item.foot.h;
      acc.area += area;
      acc.x += (item.foot.x + item.foot.w / 2) * area;
      acc.y += (item.foot.y + item.foot.h / 2) * area;
      return acc;
    },
    { area: 0, x: 0, y: 0 },
  );
  const centroid = { x: weighted.x / weighted.area, y: weighted.y / weighted.area };
  const distance = Math.hypot(centroid.x - roomCenter.x, centroid.y - roomCenter.y);
  return 1 - Math.min(1, distance / Math.hypot(cfg.W / 2, cfg.D / 2));
}

// Rang 2 — MIMOHOD MED UPORABO (mehko): ko so uporabniki na svojih mestih (človeški
// kvadri), ali ostane mimohodni koridor za še enega človeka. Meri najožjo širino
// poti od vrat do nasprotnega kota ob postavljenih človeških kvadrih. ~600 mm bočno
// = en človeški kvader; nikoli ne zavrne, le da prednost rešitvi z več zraka.
function measurePassingWhileUsed(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const items = fixtures(candidate);
  const humans = items.map(humanUsageBox).filter((box): box is Box3D => Boolean(box));
  if (humans.length === 0) return 1;

  const door = candidate.placed.find((item): item is PlacedDoor => item.kind === 'door');
  if (!door) {
    const occupiedWidth = humans.reduce((sum, box) => sum + Math.min(box.w, box.h), 0);
    return 1 - Math.min(1, occupiedWidth / Math.max(Math.min(cfg.W, cfg.D), 1));
  }

  const obstacles = [...items.map(elementBox), ...humans];
  const grid = buildFreeGrid(cfg.W, cfg.D, obstacles);
  const entry = { x: door.pass.x + door.pass.w / 2, y: door.pass.y + door.pass.h / 2 };
  const far = { x: cfg.W - entry.x, y: cfg.D - entry.y };
  const width = corridorWidth(grid, entry, far);
  return clamp01(width / 1200);
}

function measureDaylightAccess(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const items = fixtures(candidate);
  const windows = items.filter((item) => item.el.kind === 'window');
  const users = items.filter((item) => item.el.usage?.posture && item.el.usage.posture !== 'none');
  if (windows.length === 0 || users.length === 0) return 0.5;
  const diagonal = Math.hypot(cfg.W, cfg.D);
  const average = users.reduce((sum, user) => {
    const userCenter = { x: user.foot.x + user.foot.w / 2, y: user.foot.y + user.foot.h / 2 };
    const nearest = Math.min(
      ...windows.map((window) =>
        Math.hypot(userCenter.x - (window.foot.x + window.foot.w / 2), userCenter.y - (window.foot.y + window.foot.h / 2)),
      ),
    );
    return sum + nearest;
  }, 0) / users.length;
  return 1 - Math.min(1, average / diagonal);
}

// Udobje poti (mehko, rang 2): koliko najožja dejanska pot od vrat do uporabne
// točke vsakega elementa doseže ŽELENO širino (cfg.pathWant). 1 = vse poti udobne,
// 0 = kakšna pot ni dosegljiva. Polnopravni kanal — utež (prior/learned/zaupanje)
// se nastavlja na testni mizi kot pri ostalih.
function measurePathComfort(candidate: LayoutCandidate, cfg: RoomConfig): number {
  const want = cfg.pathWant ?? 900;
  const items = fixtures(candidate);
  const door = candidate.placed.find((item): item is PlacedDoor => item.kind === 'door');
  if (!door || items.length === 0) return 1;

  const grid = buildFreeGrid(cfg.W, cfg.D, items.map(elementBox));
  const entry = doorInteriorPoint(door);
  let min = Infinity;
  for (const item of items) {
    const result = findPath(grid, entry, usagePoint(item), 100);
    if (!result.reachable) return 0;
    if (result.minWidth < min) min = result.minWidth;
  }
  return min === Infinity ? 1 : Math.max(0, Math.min(1, min / Math.max(want, 1)));
}

function centerDistance(a: PlacedFixture, b: PlacedFixture): number {
  return Math.hypot(a.foot.x + a.foot.w / 2 - (b.foot.x + b.foot.w / 2), a.foot.y + a.foot.h / 2 - (b.foot.y + b.foot.h / 2));
}

function normalizeLearned(channels: Channel[]): Channel[] {
  const total = channels.reduce((sum, channel) => sum + channel.learned, 0) || 1;
  return channels.map((channel) => ({ ...channel, learned: clamp01(channel.learned / total) }));
}

function clamp01(value: number): number {
  return Math.max(0.01, Math.min(0.99, value));
}
