import type { Point } from './geometry';
import type { Box3D } from './volume';

// Višina pasu, ki ga potrebuje človek med hojo (mm). Instalacija nad to višino
// (npr. zračnik pri stropu) ne zapre tlorisne celice — to je "višinski filter"
// iz Nadgradnje 3.0 (§1: poti = tloris z višinskim filtrom).
export const WALK_HEIGHT = 1900;

// Privzeta širina prehoda za rang 1 (prehodnost): koliko prostora potrebuje en
// človek, da fizično pride mimo. Rang 2 (mimohod, mehko) uporablja širši prag.
export const RANK1_PASS_WIDTH = 500;

export interface FreeGrid {
  cell: number;
  cols: number;
  rows: number;
  W: number;
  D: number;
  blocked: Uint8Array; // 1 = celica zasedena v človeški višini
  clearance: Float32Array; // mm do najbližje zasedene celice ali zidu (0 = zasedeno)
}

const SQRT2 = Math.SQRT2;

/**
 * Zgradi fino mrežo prostega prostora. Celica je zasedena le, če jo nek volumen
 * zaseda znotraj človeške višine (z < WALK_HEIGHT) — instalacije pri stropu so
 * prosojne za hojo.
 */
export function buildFreeGrid(W: number, D: number, obstacles: Box3D[], cell = 100): FreeGrid {
  const cols = Math.max(1, Math.ceil(W / cell));
  const rows = Math.max(1, Math.ceil(D / cell));
  const blocked = new Uint8Array(cols * rows);

  const walking = obstacles.filter((box) => box.z < WALK_HEIGHT && box.h3 > 0);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cx = (c + 0.5) * cell;
      const cy = (r + 0.5) * cell;
      let isBlocked = false;
      for (const box of walking) {
        if (cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h) {
          isBlocked = true;
          break;
        }
      }
      blocked[r * cols + c] = isBlocked ? 1 : 0;
    }
  }

  const clearance = distanceTransform(blocked, cols, rows, cell, W, D);
  return { cell, cols, rows, W, D, blocked, clearance };
}

/**
 * Chamfer razdaljna transformacija: vsaki prosti celici pripiše približno
 * evklidsko razdaljo (mm) do najbližje zasedene celice; nato omeji še z
 * razdaljo do zidu (rob sobe je tudi ovira za telo).
 */
function distanceTransform(
  blocked: Uint8Array,
  cols: number,
  rows: number,
  cell: number,
  W: number,
  D: number,
): Float32Array {
  const dist = new Float32Array(cols * rows);
  for (let i = 0; i < dist.length; i += 1) dist[i] = blocked[i] ? 0 : Infinity;

  const ortho = cell;
  const diag = cell * SQRT2;

  // naprej
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (dist[i] === 0) continue;
      if (c > 0) dist[i] = Math.min(dist[i], dist[i - 1] + ortho);
      if (r > 0) dist[i] = Math.min(dist[i], dist[i - cols] + ortho);
      if (r > 0 && c > 0) dist[i] = Math.min(dist[i], dist[i - cols - 1] + diag);
      if (r > 0 && c < cols - 1) dist[i] = Math.min(dist[i], dist[i - cols + 1] + diag);
    }
  }
  // nazaj
  for (let r = rows - 1; r >= 0; r -= 1) {
    for (let c = cols - 1; c >= 0; c -= 1) {
      const i = r * cols + c;
      if (dist[i] === 0) continue;
      if (c < cols - 1) dist[i] = Math.min(dist[i], dist[i + 1] + ortho);
      if (r < rows - 1) dist[i] = Math.min(dist[i], dist[i + cols] + ortho);
      if (r < rows - 1 && c < cols - 1) dist[i] = Math.min(dist[i], dist[i + cols + 1] + diag);
      if (r < rows - 1 && c > 0) dist[i] = Math.min(dist[i], dist[i + cols - 1] + diag);
    }
  }

  // omeji z razdaljo do zidu (telo se ne more prebiti skozi zid)
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const i = r * cols + c;
      if (dist[i] === 0) continue;
      const cx = (c + 0.5) * cell;
      const cy = (r + 0.5) * cell;
      const wall = Math.min(cx, cy, W - cx, D - cy);
      dist[i] = Math.min(dist[i], wall);
    }
  }

  return dist;
}

function cellIndex(grid: FreeGrid, point: Point): { c: number; r: number } {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor(point.x / grid.cell)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor(point.y / grid.cell)));
  return { c, r };
}

function cellCenter(grid: FreeGrid, index: number): Point {
  const c = index % grid.cols;
  const r = Math.floor(index / grid.cols);
  return { x: (c + 0.5) * grid.cell, y: (r + 0.5) * grid.cell };
}

/**
 * Poišče najbližjo celico okrog dane točke, ki prenese telo polmera `radius`
 * (clearance ≥ radius). Spiralno iskanje navzven do `maxRings` celic.
 */
function nearestPassable(grid: FreeGrid, point: Point, radius: number, maxRings = 8): number | null {
  const { c, r } = cellIndex(grid, point);
  for (let ring = 0; ring <= maxRings; ring += 1) {
    for (let dr = -ring; dr <= ring; dr += 1) {
      for (let dc = -ring; dc <= ring; dc += 1) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= grid.rows || cc >= grid.cols) continue;
        const i = rr * grid.cols + cc;
        if (grid.clearance[i] >= radius) return i;
      }
    }
  }
  return null;
}

/**
 * Rang 1 — PREHODNOST (trdo): obstaja li koridor širine ≥ passWidth od `from`
 * do `to` skozi prosti prostor. BFS po celicah s clearance ≥ passWidth/2.
 */
export function reachable(grid: FreeGrid, from: Point, to: Point, passWidth = RANK1_PASS_WIDTH): boolean {
  const radius = passWidth / 2;
  const start = nearestPassable(grid, from, radius);
  const goal = nearestPassable(grid, to, radius);
  if (start === null || goal === null) return false;
  if (start === goal) return true;

  const visited = new Uint8Array(grid.cols * grid.rows);
  const queue: number[] = [start];
  visited[start] = 1;
  const neighbours = [-1, 1, -grid.cols, grid.cols, -grid.cols - 1, -grid.cols + 1, grid.cols - 1, grid.cols + 1];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) return true;
    const cc = current % grid.cols;
    for (const offset of neighbours) {
      const next = current + offset;
      if (next < 0 || next >= grid.clearance.length || visited[next]) continue;
      // prepreči ovijanje čez rob mreže
      const nc = next % grid.cols;
      if (Math.abs(nc - cc) > 1) continue;
      if (grid.clearance[next] < radius) continue;
      visited[next] = 1;
      queue.push(next);
    }
  }
  return false;
}

export interface PathResult {
  reachable: boolean;
  path: Point[]; // narisljiva trasa (od → do), [] če celo izhodišča ni
  minWidth: number; // najožja širina koridorja vzdolž poti (mm)
  narrowest: Point | null; // mesto najožje točke
  blockedAt: Point | null; // kje se pot zatakne (najbližji doseg cilju), če ni prehodna
}

/**
 * Rang 1 kot VIDNI objekt (steklena škatla): vrne dejansko traso od `from` do
 * `to` skozi prosti prostor (BFS po celicah s clearance ≥ passWidth/2), najožjo
 * točko vzdolž nje, ali — ob neprehodnosti — mesto, kjer se pot zatakne.
 */
export function findPath(grid: FreeGrid, from: Point, to: Point, passWidth = RANK1_PASS_WIDTH): PathResult {
  const radius = passWidth / 2;
  const start = nearestPassable(grid, from, radius);
  const goal = nearestPassable(grid, to, radius);
  if (start === null) return { reachable: false, path: [], minWidth: 0, narrowest: null, blockedAt: from };
  if (goal === null) return { reachable: false, path: [], minWidth: 0, narrowest: null, blockedAt: to };

  const parent = new Int32Array(grid.cols * grid.rows).fill(-1);
  const visited = new Uint8Array(grid.cols * grid.rows);
  const queue: number[] = [start];
  visited[start] = 1;
  const neighbours = [-1, 1, -grid.cols, grid.cols, -grid.cols - 1, -grid.cols + 1, grid.cols - 1, grid.cols + 1];

  let reached = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === goal) {
      reached = true;
      break;
    }
    const cc = current % grid.cols;
    for (const offset of neighbours) {
      const next = current + offset;
      if (next < 0 || next >= grid.clearance.length || visited[next]) continue;
      if (Math.abs((next % grid.cols) - cc) > 1) continue;
      if (grid.clearance[next] < radius) continue;
      visited[next] = 1;
      parent[next] = current;
      queue.push(next);
    }
  }

  if (!reached) {
    // najbližji obiskani celici cilju = kje se pot zatakne
    let closest = start;
    let bestDist = Infinity;
    const goalPt = cellCenter(grid, goal);
    for (let i = 0; i < visited.length; i += 1) {
      if (!visited[i]) continue;
      const p = cellCenter(grid, i);
      const dist = Math.hypot(p.x - goalPt.x, p.y - goalPt.y);
      if (dist < bestDist) {
        bestDist = dist;
        closest = i;
      }
    }
    return { reachable: false, path: [], minWidth: 0, narrowest: null, blockedAt: cellCenter(grid, closest) };
  }

  const cells: number[] = [];
  for (let i = goal; i !== -1; i = parent[i]) cells.push(i);
  cells.reverse();

  let minWidth = Infinity;
  let narrowest: Point | null = null;
  for (const cell of cells) {
    const width = grid.clearance[cell] * 2;
    if (width < minWidth) {
      minWidth = width;
      narrowest = cellCenter(grid, cell);
    }
  }

  const path = simplify([from, ...cells.map((cell) => cellCenter(grid, cell)), to]);
  return { reachable: true, path, minWidth: minWidth === Infinity ? 0 : minWidth, narrowest, blockedAt: null };
}

// odstrani kolinearne vmesne točke, da je trasa berljiva
function simplify(points: Point[]): Point[] {
  if (points.length <= 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Najožja širina koridorja vzdolž najboljše (bottleneck) poti od `from` do `to`.
 * Vrne mm; 0 če cilja ni mogoče doseči. Uporabno za rang-2 mehki signal.
 */
export function corridorWidth(grid: FreeGrid, from: Point, to: Point): number {
  const start = nearestPassable(grid, from, 0);
  const goal = nearestPassable(grid, to, 0);
  if (start === null || goal === null) return 0;

  // max-min (widest path) Dijkstra: maksimiraj najmanjši clearance vzdolž poti.
  const best = new Float32Array(grid.cols * grid.rows);
  best[start] = grid.clearance[start];
  const pending = new Set<number>([start]);
  const neighbours = [-1, 1, -grid.cols, grid.cols, -grid.cols - 1, -grid.cols + 1, grid.cols - 1, grid.cols + 1];

  while (pending.size > 0) {
    let current = -1;
    let bestWidth = -1;
    for (const node of pending) {
      if (best[node] > bestWidth) {
        bestWidth = best[node];
        current = node;
      }
    }
    pending.delete(current);
    if (current === goal) return best[goal] * 2;
    const cc = current % grid.cols;
    for (const offset of neighbours) {
      const next = current + offset;
      if (next < 0 || next >= grid.clearance.length) continue;
      const nc = next % grid.cols;
      if (Math.abs(nc - cc) > 1) continue;
      const width = Math.min(best[current], grid.clearance[next]);
      if (width > best[next]) {
        best[next] = width;
        pending.add(next);
      }
    }
  }

  return best[goal] * 2;
}
