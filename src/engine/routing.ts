import type { Connection, Wall } from '../elements/model';
import type { RoomConfig } from '../constraints/brief';
import type { PlacedElement, PlacedFixture } from './evaluator';
import type { Point } from './geometry';

export interface RoutingPolicy {
  allowFloorRoutes: boolean;
}

export interface ServiceRoute {
  id: string;
  fixtureName: string;
  connection: Connection;
  from: Point;
  to: Point;
  path: Point[]; // dejanska poliferna trasa (po tleh ali po steni)
  via: 'wall' | 'floor';
  length: number;
  rerouted: boolean; // priklop v tla, preusmerjen po steni, ker talne trase niso dovoljene
  crossesFloorRoute: boolean;
}

export interface RoutingResult {
  routes: ServiceRoute[];
  totalLength: number;
  reroutedCount: number;
  floorCrossingCount: number;
}

const DEFAULT_POLICY: RoutingPolicy = {
  allowFloorRoutes: true,
};

export function routeServices(
  placed: PlacedElement[],
  cfg: RoomConfig,
  policy: RoutingPolicy = DEFAULT_POLICY,
): RoutingResult {
  const fixtures = placed.filter((item): item is PlacedFixture => item.kind !== 'door');
  const routes = fixtures.flatMap((fixture) =>
    fixture.el.conns.map((connection) => {
      const from = placedConnectionPoint(fixture, connection);
      const to = projectToWetWall(from, cfg.wetWall, cfg.W, cfg.D);
      const wantsFloor = connection.routesTo === 'floor';
      const useFloor = wantsFloor && policy.allowFloorRoutes;

      // Po tleh = ravna trasa pod ploščo. Po steni = trasa po obodu (hugging),
      // saj cev ne sme čez tla.
      const path = useFloor ? [from, to] : wallPath(from, fixture.wall, cfg.wetWall, cfg.W, cfg.D);

      return {
        id: `${fixture.name}-${connection.id}`,
        fixtureName: fixture.name,
        connection,
        from,
        to,
        path,
        via: useFloor ? 'floor' : 'wall',
        length: polylineLength(path),
        rerouted: wantsFloor && !policy.allowFloorRoutes,
        crossesFloorRoute: false,
      } satisfies ServiceRoute;
    }),
  );

  markFloorCrossings(routes);

  return {
    routes,
    totalLength: routes.reduce((sum, route) => sum + route.length, 0),
    reroutedCount: routes.filter((route) => route.rerouted).length,
    floorCrossingCount: routes.filter((route) => route.crossesFloorRoute).length,
  };
}

export function placedConnectionPoint(fixture: PlacedFixture, connection: Connection): Point {
  const { foot, wall } = fixture;

  if (wall === 'N') {
    if (connection.side === 'back') return { x: foot.x + connection.off * foot.w, y: foot.y };
    if (connection.side === 'front') return { x: foot.x + connection.off * foot.w, y: foot.y + foot.h };
    if (connection.side === 'left') return { x: foot.x, y: foot.y + connection.off * foot.h };
    return { x: foot.x + foot.w, y: foot.y + connection.off * foot.h };
  }

  if (wall === 'S') {
    if (connection.side === 'back') return { x: foot.x + connection.off * foot.w, y: foot.y + foot.h };
    if (connection.side === 'front') return { x: foot.x + connection.off * foot.w, y: foot.y };
    if (connection.side === 'left') return { x: foot.x, y: foot.y + (1 - connection.off) * foot.h };
    return { x: foot.x + foot.w, y: foot.y + (1 - connection.off) * foot.h };
  }

  if (wall === 'W') {
    if (connection.side === 'back') return { x: foot.x, y: foot.y + connection.off * foot.h };
    if (connection.side === 'front') return { x: foot.x + foot.w, y: foot.y + connection.off * foot.h };
    if (connection.side === 'left') return { x: foot.x + connection.off * foot.w, y: foot.y + foot.h };
    return { x: foot.x + connection.off * foot.w, y: foot.y };
  }

  if (connection.side === 'back') return { x: foot.x + foot.w, y: foot.y + connection.off * foot.h };
  if (connection.side === 'front') return { x: foot.x, y: foot.y + connection.off * foot.h };
  if (connection.side === 'left') return { x: foot.x + (1 - connection.off) * foot.w, y: foot.y };
  return { x: foot.x + (1 - connection.off) * foot.w, y: foot.y + foot.h };
}

export function projectToWetWall(point: Point, wetWall: Wall, roomW: number, roomD: number): Point {
  if (wetWall === 'N') return { x: point.x, y: 0 };
  if (wetWall === 'S') return { x: point.x, y: roomD };
  if (wetWall === 'W') return { x: 0, y: point.y };
  return { x: roomW, y: point.y };
}

function projectToWall(point: Point, wall: Wall, roomW: number, roomD: number): Point {
  if (wall === 'N') return { x: point.x, y: 0 };
  if (wall === 'S') return { x: point.x, y: roomD };
  if (wall === 'W') return { x: 0, y: point.y };
  return { x: roomW, y: point.y };
}

/**
 * Trasa po stenah (obodu) od priklopa do mokrega zidu: cev gre do svojega zidu,
 * nato po obodu sobe (mimo vogalov) do mokrega zidu — nikoli čez tla.
 */
export function wallPath(from: Point, fixtureWall: Wall, wetWall: Wall, roomW: number, roomD: number): Point[] {
  const start = projectToWall(from, fixtureWall, roomW, roomD);
  const end = projectToWetWall(from, wetWall, roomW, roomD);
  const perim = 2 * (roomW + roomD);
  const s1 = perimeterS(start, roomW, roomD);
  const s2 = perimeterS(end, roomW, roomD);

  const fwd = mod(s2 - s1, perim);
  const bwd = perim - fwd;
  const dir = fwd <= bwd ? 1 : -1;
  const span = dir === 1 ? fwd : bwd;

  const cornerS = [0, roomW, roomW + roomD, 2 * roomW + roomD];
  const mids = cornerS
    .map((c) => ({ c, d: mod((c - s1) * dir, perim) }))
    .filter((o) => o.d > 1 && o.d < span - 1)
    .sort((a, b) => a.d - b.d)
    .map((o) => perimeterPoint(o.c, roomW, roomD));

  return dedupe([from, start, ...mids, end]);
}

function perimeterS(p: Point, W: number, D: number): number {
  const eps = 1;
  if (Math.abs(p.y) <= eps) return clampN(p.x, 0, W); // N
  if (Math.abs(p.x - W) <= eps) return W + clampN(p.y, 0, D); // E
  if (Math.abs(p.y - D) <= eps) return W + D + (W - clampN(p.x, 0, W)); // S
  return 2 * W + D + (D - clampN(p.y, 0, D)); // W
}

function perimeterPoint(s: number, W: number, D: number): Point {
  const perim = 2 * (W + D);
  const t = mod(s, perim);
  if (t <= W) return { x: t, y: 0 };
  if (t <= W + D) return { x: W, y: t - W };
  if (t <= 2 * W + D) return { x: W - (t - (W + D)), y: D };
  return { x: 0, y: D - (t - (2 * W + D)) };
}

function polylineLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

function dedupe(path: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) out.push(p);
  }
  return out;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function clampN(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function markFloorCrossings(routes: ServiceRoute[]): void {
  const floorRoutes = routes.filter((route) => route.via === 'floor');
  for (let i = 0; i < floorRoutes.length; i += 1) {
    for (let j = i + 1; j < floorRoutes.length; j += 1) {
      if (axisAlignedSegmentsCross(floorRoutes[i].from, floorRoutes[i].to, floorRoutes[j].from, floorRoutes[j].to)) {
        floorRoutes[i].crossesFloorRoute = true;
        floorRoutes[j].crossesFloorRoute = true;
      }
    }
  }
}

function axisAlignedSegmentsCross(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const aVertical = a1.x === a2.x;
  const bVertical = b1.x === b2.x;
  if (aVertical === bVertical) return false;

  const vertical = aVertical ? [a1, a2] : [b1, b2];
  const horizontal = aVertical ? [b1, b2] : [a1, a2];
  const vx = vertical[0].x;
  const hy = horizontal[0].y;
  const vMinY = Math.min(vertical[0].y, vertical[1].y);
  const vMaxY = Math.max(vertical[0].y, vertical[1].y);
  const hMinX = Math.min(horizontal[0].x, horizontal[1].x);
  const hMaxX = Math.max(horizontal[0].x, horizontal[1].x);

  const crosses = vx > hMinX && vx < hMaxX && hy > vMinY && hy < vMaxY;
  return crosses;
}
