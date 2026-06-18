import type { ProgramInstance, RoomConfig } from '../constraints/brief';
import type { NoGoZone } from '../constraints/zones';
import type { ElementLibrary } from '../elements/library';
import type { Wall } from '../elements/model';
import { isDoor, orientation, serviceSides } from '../elements/model';

export interface FeasibilityResult {
  feasible: boolean;
  reasons: string[];
}

export function checkFeasibility(
  library: ElementLibrary,
  program: ProgramInstance[],
  cfg: RoomConfig,
  zones: NoGoZone[] = [],
): FeasibilityResult {
  const reasons: string[] = [];
  const roomArea = cfg.W * cfg.D;
  const blockedArea = zones.reduce((sum, zone) => sum + zone.w * zone.h, 0);
  const usableArea = roomArea - blockedArea;
  let requiredArea = 0;
  let hasDoor = false;

  if (cfg.W <= 0 || cfg.D <= 0) reasons.push('dimenzije prostora niso veljavne');
  if (usableArea <= 0) reasons.push('prepovedane cone pokrijejo cel prostor');

  for (const instance of program) {
    const element = library[instance.key];
    if (!element) {
      reasons.push(`neznan element v programu (${instance.key})`);
      continue;
    }

    if (isDoor(element)) {
      hasDoor = true;
      const width = instance.w || element.w;
      const candidateWalls = instance.wall && instance.wall !== 'auto' ? [instance.wall] : (['N', 'S', 'E', 'W'] as Wall[]);
      const fitsAnyWall = candidateWalls.some((wall) => wallLength(wall, cfg) - width >= 80);
      if (!fitsAnyWall) reasons.push(`vrata ${element.name} se ne prilegajo izbranemu zidu`);
      requiredArea += width * 520;
      continue;
    }

    const elementOrientation = orientation(element);
    if (elementOrientation.warn) reasons.push(`${element.name}: ${elementOrientation.txt}`);
    if (elementOrientation.corner) reasons.push(`${element.name}: vogalna postavitev se ni podprta`);
    if (serviceSides(element).length > 1) continue;

    const fitsAnyWall = (['N', 'S', 'E', 'W'] as Wall[]).some((wall) => wallLength(wall, cfg) >= element.w);
    if (!fitsAnyWall) reasons.push(`${element.name} je preširok za vse zidove`);
    requiredArea += element.w * (element.d + element.clear.core);
  }

  if (!hasDoor) reasons.push('soba nima vrat');
  if (requiredArea > usableArea) {
    reasons.push(
      `program potrebuje vsaj ${(requiredArea / 1e6).toFixed(2)} m2, uporabnega prostora je ${(usableArea / 1e6).toFixed(2)} m2`,
    );
  }

  return {
    feasible: reasons.length === 0,
    reasons: [...new Set(reasons)],
  };
}

function wallLength(wall: Wall, cfg: RoomConfig): number {
  return wall === 'N' || wall === 'S' ? cfg.W : cfg.D;
}
