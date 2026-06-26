import type { ReferenceObservation } from '../rules/induction';
import type { NormalizedIfcElement, NormalizedIfcPlan, NormalizedIfcRoom } from './normalizedPlan';

const SUPPORTED_CLEARANCE_ELEMENTS = new Set(['toilet', 'sink', 'desk', 'chair', 'cabinet']);

export function observationsFromNormalizedPlan(plan: NormalizedIfcPlan): ReferenceObservation[] {
  const observations: ReferenceObservation[] = [];
  for (const corridor of plan.corridors || []) {
    observations.push({
      ref: `${plan.sourceId}:${corridor.sourceId}:corridor-width`,
      roomType: 'corridor',
      scope: 'room-type',
      elementKey: 'corridor',
      parameter: corridor.role === 'main' ? 'corridor-width-main' : 'corridor-width-side',
      value: Math.round(corridor.width),
      note: `Extracted ${corridor.role} corridor width from normalized IFC plan ${plan.name}`,
    });
  }
  for (const room of plan.rooms) {
    for (const element of room.elements) {
      if (!SUPPORTED_CLEARANCE_ELEMENTS.has(element.elementKey)) continue;
      observations.push({
        ref: `${plan.sourceId}:${room.sourceId}:${element.sourceId}:clearance-front`,
        roomType: room.roomType,
        scope: 'room-type',
        elementKey: element.elementKey,
        parameter: 'clearance-front',
        value: Math.round(frontClearance(room, element)),
        note: `Extracted from normalized IFC room ${room.name}`,
      });
    }
  }
  return observations.filter((observation) => Number.isFinite(observation.value) && observation.value >= 0);
}

export function frontClearance(room: NormalizedIfcRoom, element: NormalizedIfcElement): number {
  if (element.facing === 'N') return room.d - (element.y + element.d);
  if (element.facing === 'S') return element.y;
  if (element.facing === 'E') return room.w - (element.x + element.w);
  return element.x;
}
