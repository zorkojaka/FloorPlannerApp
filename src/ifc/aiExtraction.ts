/**
 * Druga uvozna pot poleg IFC: realni načrt (slika/PDF) → AI-ekstrakcija →
 * strukturiran JSON v obliki NormalizedIfcPlan. Isti ciljni model kot IFC uvoz,
 * zato ga uživa ista strateška indukcija (project/projectTraining).
 */

import type { NormalizedIfcPlan, NormalizedIfcRoom, NormalizedIfcCorridor, NormalizedIfcElement, BBox } from './normalizedPlan';
import type { RoomType, WcKind } from '../project/roomTypes';

export const AI_EXTRACTION_PROMPT = `Si arhitekturni ekstraktor. Priložil ti bom sliko ali PDF tlorisa etaže.
Vrni SAMO veljaven JSON (brez razlage) v tej obliki — dimenzije v MILIMETRIH, bbox v deležih slike (0..1):

{
  "sourceId": "kratka-oznaka-nacrta",
  "name": "Ime načrta",
  "corridors": [
    { "sourceId": "c1", "name": "Glavni hodnik", "role": "main", "width": 1800 }
  ],
  "rooms": [
    { "sourceId": "r1", "name": "Pisarna 1", "roomType": "office", "zone": "work",     "w": 4200, "d": 5000, "bbox": { "x": 0.12, "y": 0.20, "w": 0.18, "h": 0.25 },
      "elements": [ { "sourceId": "r1-e1", "name": "Pisalna miza", "elementKey": "desk", "x": 300, "y": 3600, "w": 1400, "d": 800, "facing": "N" } ] },
    { "sourceId": "r2", "name": "WC moški",   "roomType": "wc", "wcKind": "male",   "zone": "sanitary", "w": 2400, "d": 2200, "bbox": { "x": 0.62, "y": 0.10, "w": 0.10, "h": 0.09 },
      "elements": [ { "sourceId": "r2-e1", "name": "WC školjka", "elementKey": "toilet", "x": 200, "y": 1400, "w": 400, "d": 600, "facing": "N" } ] },
    { "sourceId": "r3", "name": "WC ženski",  "roomType": "wc", "wcKind": "female", "zone": "sanitary", "w": 2400, "d": 2200, "bbox": { "x": 0.62, "y": 0.20, "w": 0.10, "h": 0.09 }, "elements": [] }
  ]
}

Pravila:
- roomType je eno od: "office", "wc". Hodnike daj v "corridors", NE med "rooms".
- wcKind (samo za WC) je eno od: "male", "female", "unisex". Če ni jasno, izpusti (velja unisex).
- zone (neobvezno) je namembnostna/čistostna cona: "work", "sanitary", "service", "technical". Če ni jasno, izpusti.
- corridors.role je "main" (širša hrbtenica) ali "side" (ožji povezovalni hodnik).
- w = širina, d = globina prostora v mm. Če meri ni, oceni iz merila/legende.
- bbox = pravokotnik prostora na sliki v DELEŽIH (x,y = zgornji levi kot, w,h = širina/višina; vse 0..1). Obvezen za vsak prostor, da lahko preverimo ujemanje.
- elements (neobvezno, a zaželeno kjer je oprema čitljiva): oprema/pohištvo v prostoru.
  elementKey je eno od: "toilet", "sink", "urinal", "desk", "chair", "cabinet", "shelf".
  x, y = odmik elementa od zgornjega levega kota PROSTORA v mm; w, d = mere elementa v mm;
  facing = stran, v katero je element obrnjen ("N" | "E" | "S" | "W"; N = proti manjšemu y).
  Iz teh meritev se učijo pravila odmikov, zato raje izpusti element, kot da ugibaš mere.
- Ne izmišljaj prostorov, ki jih na načrtu ni. Vključi vse čitljive prostore.`;

/** Iz morebiti ovitega odgovora (```json ...```) izlušči prvi JSON objekt. */
export function stripToJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end < start) throw new Error('V odgovoru ni JSON objekta.');
  return text.slice(start, end + 1);
}

function parseBBox(value: unknown): BBox | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const coords = ['x', 'y', 'w', 'h'].map((key) => {
    const n = typeof raw[key] === 'string' ? Number(raw[key]) : raw[key];
    return typeof n === 'number' && Number.isFinite(n) ? n : NaN;
  });
  if (coords.some((n) => Number.isNaN(n))) return undefined;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  return { x: clamp01(coords[0]), y: clamp01(coords[1]), w: clamp01(coords[2]), h: clamp01(coords[3]) };
}

const VALID_ROOM_TYPES: RoomType[] = ['office', 'wc', 'corridor'];
const VALID_WC_KINDS: WcKind[] = ['male', 'female', 'unisex'];
const VALID_FACINGS = new Set(['N', 'E', 'S', 'W']);

/**
 * Elementi so za indukcijo pravil dragoceni, a neobvezni: posamezen okvarjen
 * element se IZPUSTI (ne podre celega uvoza) — ekstrakcija mora biti robustna.
 */
function parseElements(value: unknown, roomIndex: number): NormalizedIfcElement[] {
  if (!Array.isArray(value)) return [];
  const elements: NormalizedIfcElement[] = [];
  value.forEach((item, index) => {
    const el = (item ?? {}) as Record<string, unknown>;
    const nums = ['x', 'y', 'w', 'd'].map((key) => {
      const n = typeof el[key] === 'string' ? Number(el[key]) : el[key];
      return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : NaN;
    });
    if (!el.elementKey || nums.some((n) => Number.isNaN(n)) || nums[2] <= 0 || nums[3] <= 0) return;
    elements.push({
      sourceId: String(el.sourceId || `room-${roomIndex + 1}-el-${index + 1}`),
      name: String(el.name || String(el.elementKey)),
      elementKey: String(el.elementKey),
      x: Math.round(nums[0]),
      y: Math.round(nums[1]),
      w: Math.round(nums[2]),
      d: Math.round(nums[3]),
      facing: VALID_FACINGS.has(String(el.facing)) ? (String(el.facing) as NormalizedIfcElement['facing']) : 'N',
    });
  });
  return elements;
}

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
      data = JSON.parse(stripToJson(input));
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
      zone: room.zone ? String(room.zone) : undefined,
      w: Math.round(num(room.w, `rooms[${index}].w`)),
      d: Math.round(num(room.d, `rooms[${index}].d`)),
      bbox: parseBBox(room.bbox),
      elements: parseElements(room.elements, index),
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
