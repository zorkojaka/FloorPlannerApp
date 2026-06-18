import type { ProgramInstance, RoomConfig } from '../constraints/brief';
import type { NoGoZone } from '../constraints/zones';
import type { Element, Wall } from '../elements/model';
import type { Evaluation, PlacedElement } from './evaluator';
import type { ElementLibrary } from '../elements/library';
import { clamp } from '../shared/math';
import { isDoor, serviceSides } from '../elements/model';
import { doorRects, placeRects } from './geometry';
import { evalPlace } from './evaluator';
import { checkFeasibility } from './feasibility';

export interface LayoutCandidate {
  placed: PlacedElement[];
  ev: Evaluation;
}

export interface GenerateLayoutOptions {
  library: ElementLibrary;
  program: ProgramInstance[];
  cfg: RoomConfig;
  soft: boolean;
  zones?: NoGoZone[];
  samples?: number;
}

const WALLS: Wall[] = ['N', 'S', 'E', 'W'];

export function generateLayoutPool({
  library,
  program,
  cfg,
  soft,
  zones = [],
  samples = 1100,
}: GenerateLayoutOptions): LayoutCandidate[] {
  if (!checkFeasibility(library, program, cfg, zones).feasible) return [];

  const instances = program
    .map((instance) => ({ ...instance, el: library[instance.key] }))
    .filter((instance): instance is ProgramInstance & { el: Element } => {
      return Boolean(instance.el && (isDoor(instance.el) || serviceSides(instance.el).length <= 1));
    });

  const out: LayoutCandidate[] = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const placed: PlacedElement[] = [];
    let ok = true;

    for (const instance of instances) {
      const element = instance.el;
      if (isDoor(element)) {
        const wall = instance.wall && instance.wall !== 'auto' ? instance.wall : WALLS[Math.floor(Math.random() * 4)];
        const wallLength = wall === 'N' || wall === 'S' ? cfg.W : cfg.D;
        const width = instance.w || element.w;
        const span = wallLength - width;
        if (span < 80) {
          ok = false;
          break;
        }

        const pos = instance.fixedPos ? clamp((instance.fpos ?? 0.5) * span, 0, span) : Math.random() * span;
        const hinge = instance.hinge !== 'auto' && instance.hinge !== undefined ? instance.hinge : Math.random() < 0.5 ? 0 : 1;
        const dir = instance.dir && instance.dir !== 'auto' ? instance.dir : Math.random() < 0.5 ? 'inward' : 'outward';
        const rects = doorRects({ ...element, w: width }, wall, pos, hinge, dir, cfg.W, cfg.D);
        placed.push({ ...rects, el: element, wall, name: element.name });
      } else {
        const wall = WALLS[Math.floor(Math.random() * 4)];
        const wallLength = wall === 'N' || wall === 'S' ? cfg.W : cfg.D;
        if (wallLength < element.w) {
          ok = false;
          break;
        }
        const pos = Math.random() * (wallLength - element.w);
        const rects = placeRects(element, wall, pos, cfg.W, cfg.D);
        placed.push({ ...rects, el: element, wall, name: element.name });
      }
    }

    if (!ok) continue;

    const ev = evalPlace(placed, cfg, soft, zones);
    if (ev.valid) out.push({ placed, ev });
  }

  const seen = new Set<string>();
  const unique: LayoutCandidate[] = [];
  for (const candidate of out) {
    const key = candidate.placed
      .map((placed) => `${placed.name[0]}${placed.wall}${Math.round(placed.foot.x / 120)}${Math.round(placed.foot.y / 120)}${placed.kind === 'door' ? placed.dir : ''}`)
      .join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  unique.sort((a, b) => b.ev.score - a.ev.score);
  return unique.slice(0, 40);
}
