/**
 * Druga uvozna pot poleg IFC: realni načrt (slika/PDF) → AI-ekstrakcija →
 * strukturiran JSON v obliki NormalizedIfcPlan. Isti ciljni model kot IFC uvoz,
 * zato ga uživa ista strateška indukcija (project/projectTraining).
 */

import type { NormalizedIfcPlan, NormalizedIfcRoom, NormalizedIfcCorridor } from './normalizedPlan';
import type { RoomType, WcKind } from '../project/roomTypes';

export const AI_EXTRACTION_PROMPT = `Si arhitekturni ekstraktor. Priložil ti bom sliko ali PDF tlorisa etaže.
Vrni SAMO veljaven JSON (brez razlage) v tej obliki — enote v MILIMETRIH:

{
  "sourceId": "kratka-oznaka-nacrta",
  "name": "Ime načrta",
  "corridors": [
    { "sourceId": "c1", "name": "Glavni hodnik", "role": "main", "width": 1800 }
  ],
  "rooms": [
    { "sourceId": "r1", "name": "Pisarna 1", "roomType": "office", "w": 4200, "d": 5000 },
    { "sourceId": "r2", "name": "WC moški",   "roomType": "wc", "wcKind": "male",   "w": 2400, "d": 2200 },
    { "sourceId": "r3", "name": "WC ženski",  "roomType": "wc", "wcKind": "female", "w": 2400, "d": 2200 }
  ]
}

Pravila:
- roomType je eno od: "office", "wc". Hodnike daj v "corridors", NE med "rooms".
- wcKind (samo za WC) je eno od: "male", "female", "unisex". Če ni jasno, izpusti (velja unisex).
- corridors.role je "main" (širša hrbtenica) ali "side" (ožji povezovalni hodnik).
- w = širina, d = globina prostora v mm. Če meri ni, oceni iz merila/legende.
- Ne izmišljaj prostorov, ki jih na načrtu ni. Vključi vse čitljive prostore.`;

const VALID_ROOM_TYPES: RoomType[] = ['office', 'wc', 'corridor'];
const VALID_WC_KINDS: WcKind[] = ['male', 'female', 'unisex'];

function num(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`Polje "${field}" mora biti pozitivno število (mm).`);
  }
  return n;
}

/** Preveri in normalizira AI-ekstrahiran JSON v NormalizedIfcPlan. */
export function parseAiExtractedPlan(input: string | unknown): NormalizedIfcPlan {
  let data: unknown;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new Error(`JSON ni veljaven: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    data = input;
  }
  if (!data || typeof data !== 'object') throw new Error('Vrhnja vrednost mora biti objekt.');
  const raw = data as Record<string, unknown>;
  if (!Array.isArray(raw.rooms) || raw.rooms.length === 0) {
    throw new Error('Načrt nima polja "rooms" (vsaj en prostor je obvezen).');
  }

  const rooms: NormalizedIfcRoom[] = raw.rooms.map((item, index) => {
    const room = (item ?? {}) as Record<string, unknown>;
    const roomType = String(room.roomType || 'office') as RoomType;
    if (!VALID_ROOM_TYPES.includes(roomType)) {
      throw new Error(`Prostor #${index + 1}: roomType "${room.roomType}" ni veljaven.`);
    }
    const wcKindRaw = room.wcKind ? (String(room.wcKind) as WcKind) : undefined;
    if (wcKindRaw && !VALID_WC_KINDS.includes(wcKindRaw)) {
      throw new Error(`Prostor #${index + 1}: wcKind "${room.wcKind}" ni veljaven.`);
    }
    return {
      sourceId: String(room.sourceId || `room-${index + 1}`),
      name: String(room.name || `Prostor ${index + 1}`),
      roomType,
      wcKind: roomType === 'wc' ? wcKindRaw : undefined,
      w: Math.round(num(room.w, `rooms[${index}].w`)),
      d: Math.round(num(room.d, `rooms[${index}].d`)),
      elements: [],
    };
  });

  const corridorsRaw = Array.isArray(raw.corridors) ? raw.corridors : [];
  const corridors: NormalizedIfcCorridor[] = corridorsRaw.map((item, index) => {
    const corridor = (item ?? {}) as Record<string, unknown>;
    const role = corridor.role === 'side' ? 'side' : 'main';
    return {
      sourceId: String(corridor.sourceId || `corridor-${index + 1}`),
      name: String(corridor.name || `Hodnik ${index + 1}`),
      role,
      width: Math.round(num(corridor.width, `corridors[${index}].width`)),
    };
  });

  return {
    sourceId: String(raw.sourceId || 'ai-plan'),
    name: String(raw.name || 'AI-ekstrahiran načrt'),
    corridors,
    rooms,
  };
}
