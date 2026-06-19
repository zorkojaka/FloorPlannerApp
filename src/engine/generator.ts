import type { ProgramInstance, RoomConfig } from '../constraints/brief';
import type { NoGoZone } from '../constraints/zones';
import type { Element, Wall } from '../elements/model';
import type { Evaluation, PlacedElement } from './evaluator';
import type { ElementLibrary } from '../elements/library';
import { clamp } from '../shared/math';
import { isDoor, serviceSides } from '../elements/model';
import { doorRects, isInsideRoom, overlapArea, placeRects } from './geometry';
import { collides3D, elementBox } from './volume';
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
  limit?: number;
  random?: () => number;
  minPathWidth?: number; // minimalna širina poti (trdo): pod njo razporeditev ni veljavna
}

// Izid iskanja loči DOKAZANO nemožnost od NISEM NAŠEL (znana omejitev iz HANDOFF):
// status 'infeasible' = predhodna izvedljivost dokaže, da ne gre; 'not-found' =
// iskanje ni zadelo veljavne rešitve (morda obstaja) → ponudi razširi iskanje.
export interface GenerateResult {
  candidates: LayoutCandidate[];
  status: 'found' | 'not-found' | 'infeasible';
  reasons: string[]; // pri 'infeasible': dokaz nemožnosti
  attempts: number; // koliko poskusov je iskanje porabilo
  expanded: boolean; // ali se je samodejno razširilo (varovalka)
}

const WALLS: Wall[] = ['N', 'S', 'E', 'W'];
const SWEEP_STEP = 60; // korak iskanja najbližjega veljavnega mesta (mm)
const DEFAULT_SAMPLES = 700;
const EXPAND_FACTOR = 4; // varovalka: razširi iskanje enkrat

/**
 * Ali bi element trčil ob že postavljene (footprint 3D / jedro / lok vrat / cona).
 * To so TRDI pogoji — element se sme premakniti samo na mesto BREZ trka. Halo je
 * mehek (dovoljen s kaznijo), zato ne šteje kot trk. Pravila ostanejo nedotaknjena.
 */
function conflictsWithPlaced(item: PlacedElement, placed: PlacedElement[], cfg: RoomConfig, zones: NoGoZone[]): boolean {
  if (!isInsideRoom(item.foot, cfg.W, cfg.D)) return true;

  for (const zone of zones) {
    if (overlapArea(item.foot, zone) > 1) return true;
    if (item.kind === 'door' && item.swing && overlapArea(item.swing, zone) > 1) return true;
  }

  for (const p of placed) {
    if (item.kind === 'door') {
      if (p.kind === 'door') {
        if (overlapArea(item.foot, p.foot) > 1) return true;
      } else {
        if (overlapArea(p.foot, item.foot) > 1) return true;
        if (item.swing && overlapArea(p.foot, item.swing) > 1) return true;
        if (overlapArea(p.foot, item.pass) > 1) return true;
      }
    } else if (p.kind === 'door') {
      if (overlapArea(item.foot, p.foot) > 1) return true;
      if (p.swing && overlapArea(item.foot, p.swing) > 1) return true;
      if (overlapArea(item.foot, p.pass) > 1) return true;
    } else {
      if (collides3D(elementBox(item), elementBox(p))) return true;
      if (overlapArea(item.hard, p.foot) > 1 || overlapArea(p.hard, item.foot) > 1) return true;
      if (overlapArea(item.hard, p.hard) > 1) return true;
    }
  }
  return false;
}

function orderedWalls(instance: ProgramInstance, random: () => number): Wall[] {
  if (instance.wall && instance.wall !== 'auto') return [instance.wall];
  const w = [...WALLS];
  for (let i = w.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [w[i], w[j]] = [w[j], w[i]];
  }
  return w;
}

/**
 * Postavi element in ga po potrebi POPRAVI: iz naključno izbrane želene pozicije
 * pomete vzdolž zidu (in po ostalih zidovih) do NAJBLIŽJEGA veljavnega mesta.
 * Tako se najdejo ozke rešitve, ki jih čisto naključje zgreši.
 */
function repairPlaceFixture(
  element: Element,
  instance: ProgramInstance,
  placed: PlacedElement[],
  cfg: RoomConfig,
  zones: NoGoZone[],
  random: () => number,
): PlacedElement | null {
  for (const wall of orderedWalls(instance, random)) {
    const wallLen = wall === 'N' || wall === 'S' ? cfg.W : cfg.D;
    if (wallLen < element.w) continue;
    const span = wallLen - element.w;
    const pref = clamp(random() * span, 0, span);
    for (let off = 0; off <= span; off += SWEEP_STEP) {
      for (const d of off === 0 ? [0] : [1, -1]) {
        const pos = clamp(pref + d * off, 0, span);
        const rects = placeRects(element, wall, pos, cfg.W, cfg.D);
        const item: PlacedElement = { ...rects, el: element, wall, name: element.name };
        if (!conflictsWithPlaced(item, placed, cfg, zones)) return item;
      }
    }
  }
  return null;
}

function repairPlaceDoor(
  element: Element,
  instance: ProgramInstance,
  placed: PlacedElement[],
  cfg: RoomConfig,
  zones: NoGoZone[],
  random: () => number,
): PlacedElement | null {
  const width = instance.w || element.w;
  const hinge = instance.hinge !== 'auto' && instance.hinge !== undefined ? instance.hinge : random() < 0.5 ? 0 : 1;
  const dir = instance.dir && instance.dir !== 'auto' ? instance.dir : random() < 0.5 ? 'inward' : 'outward';
  for (const wall of orderedWalls(instance, random)) {
    const wallLen = wall === 'N' || wall === 'S' ? cfg.W : cfg.D;
    const span = wallLen - width;
    if (span < 80) continue;
    const pref = instance.fixedPos ? clamp((instance.fpos ?? 0.5) * span, 0, span) : clamp(random() * span, 0, span);
    const maxOff = instance.fixedPos ? 0 : span;
    for (let off = 0; off <= maxOff; off += SWEEP_STEP) {
      for (const d of off === 0 ? [0] : [1, -1]) {
        const pos = clamp(pref + d * off, 0, span);
        const rects = doorRects({ ...element, w: width }, wall, pos, hinge, dir, cfg.W, cfg.D);
        const item: PlacedElement = { ...rects, el: element, name: element.name };
        if (!conflictsWithPlaced(item, placed, cfg, zones)) return item;
      }
    }
  }
  return null;
}

function runSearch(opts: GenerateLayoutOptions, samples: number): LayoutCandidate[] {
  const { library, program, cfg, soft, zones = [], minPathWidth, limit = 40, random = Math.random } = opts;

  const instances = program
    .map((instance) => ({ ...instance, el: library[instance.key] }))
    .filter((instance): instance is ProgramInstance & { el: Element } => {
      return Boolean(instance.el && (isDoor(instance.el) || serviceSides(instance.el).length <= 1));
    });

  // vrata najprej (da fiksature upoštevajo lok), nato fiksature od največje (boljše pakiranje)
  const doors = instances.filter((instance) => isDoor(instance.el));
  const fixtures = instances.filter((instance) => !isDoor(instance.el)).sort((a, b) => b.el.w * b.el.d - a.el.w * a.el.d);
  const order = [...doors, ...fixtures];

  const out: LayoutCandidate[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const placed: PlacedElement[] = [];
    let ok = true;
    for (const instance of order) {
      const item = isDoor(instance.el)
        ? repairPlaceDoor(instance.el, instance, placed, cfg, zones, random)
        : repairPlaceFixture(instance.el, instance, placed, cfg, zones, random);
      if (!item) {
        ok = false;
        break;
      }
      placed.push(item);
    }
    if (!ok) continue;

    // OCENJEVANJE NEDOTAKNJENO: končno veljavnost (vključno z globalnimi pravili —
    // prehodnost, halo v strogem načinu …) odloči evalPlace, ne repair.
    const ev = evalPlace(placed, cfg, soft, zones, minPathWidth);
    if (ev.valid) out.push({ placed, ev });
    if (out.length >= limit * 4) break; // dovolj raznolikih — omeji drag evalPlace
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
  return unique.slice(0, limit);
}

/**
 * Glavno iskanje z ločenim izidom. Najprej dokaz izvedljivosti (nemožnost), nato
 * place-and-repair iskanje; če je prazno, ENKRAT samodejno razširi (varovalka
 * proti lažnim negativom), preden javi 'not-found'.
 */
export function searchLayouts(opts: GenerateLayoutOptions): GenerateResult {
  const feas = checkFeasibility(opts.library, opts.program, opts.cfg, opts.zones ?? []);
  if (!feas.feasible) {
    return { candidates: [], status: 'infeasible', reasons: feas.reasons, attempts: 0, expanded: false };
  }

  const base = opts.samples ?? DEFAULT_SAMPLES;
  let candidates = runSearch(opts, base);
  let attempts = base;
  let expanded = false;

  if (candidates.length === 0) {
    expanded = true;
    attempts = base * EXPAND_FACTOR;
    candidates = runSearch(opts, attempts);
  }

  return {
    candidates,
    status: candidates.length > 0 ? 'found' : 'not-found',
    reasons: [],
    attempts,
    expanded,
  };
}

// Vzvratna združljivost: vrne le bazen kandidatov (UI uporablja searchLayouts za status).
export function generateLayoutPool(opts: GenerateLayoutOptions): LayoutCandidate[] {
  return searchLayouts(opts).candidates;
}
