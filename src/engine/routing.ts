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
  via: 'wall' | 'floor';
  length: number;
  blocked: boolean;
  crossesFloorRoute: boolean;
}

export interface RoutingResult {
  routes: ServiceRoute[];
  totalLength: number;
  blockedCount: number;
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
      return {
        id: `${fixture.name}-${connection.id}`,
        fixtureName: fixture.name,
        connection,
        from,
        to,
        via: connection.routesTo,
        length: manhattan(from, to),
        blocked: connection.routesTo === 'floor' && !policy.allowFloorRoutes,
        crossesFloorRoute: false,
      } satisfies ServiceRoute;
    }),
  );

  markFloorCrossings(routes);

  return {
    routes,
    totalLength: routes.reduce((sum, route) => sum + route.length, 0),
    blockedCount: routes.filter((route) => route.blocked).length,
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

function manhattan(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
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
