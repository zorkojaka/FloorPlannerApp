import type { WcKind } from '../project/roomTypes';

export interface IfcReferenceRoomSample {
  name: string;
  type: 'wc' | 'office' | 'corridor';
  wcKind?: WcKind;
  w: number;
  d: number;
}

export interface IfcReferenceCorridorSample {
  sourceId: string;
  name: string;
  role: 'main' | 'side';
  width: number;
}

export interface IfcReferenceSummary {
  id: string;
  name: string;
  file: string;
  spaces: number;
  entityCounts: Record<string, number>;
  normalized: {
    rooms: number;
    corridors: number;
    byType: Record<'office' | 'wc', number>;
    byWcKind?: Partial<Record<WcKind | 'unclassified', number>>;
  };
  corridorWidthsMm: { min: number; median: number; max: number } | null;
  sampleRooms: IfcReferenceRoomSample[];
  sampleCorridors: IfcReferenceCorridorSample[];
}

export const IFC_REFERENCE_SETS: IfcReferenceSummary[] = [
  {
    id: 'ac20-institute-var-2',
    name: 'AC20 Institute Var 2',
    file: 'AC20-Institute-Var-2.ifc',
    spaces: 82,
    entityCounts: { IfcSpace: 82, IfcDoor: 77, IfcWindow: 206, IfcFurnishingElement: 253 },
    normalized: {
      rooms: 69,
      corridors: 13,
      byType: { office: 61, wc: 8 },
      byWcKind: { male: 4, female: 4 },
    },
    corridorWidthsMm: { min: 2000, median: 2000, max: 5400 },
    sampleRooms: [
      { name: 'Besprechungsraum I', type: 'office', w: 5600, d: 4400 },
      { name: 'Besprechungsraum II', type: 'office', w: 5800, d: 4400 },
      { name: 'Technikraum I', type: 'office', w: 5800, d: 4400 },
      { name: 'Technikraum II', type: 'office', w: 5800, d: 4400 },
      { name: 'Technikraum III', type: 'office', w: 5800, d: 4400 },
      { name: 'Seminarraum', type: 'office', w: 11600, d: 11400 },
      { name: 'Technikraum IV', type: 'office', w: 4400, d: 2800 },
      { name: 'WC Herren', type: 'wc', wcKind: 'male', w: 4400, d: 2900 },
      { name: 'Labor K1', type: 'office', w: 4400, d: 2800 },
      { name: 'Labor K2', type: 'office', w: 4400, d: 2800 },
      { name: 'Labor K3', type: 'office', w: 4400, d: 2800 },
      { name: 'Labor K4', type: 'office', w: 4400, d: 2800 },
    ],
    sampleCorridors: [
      { sourceId: '29513', name: 'Flur Keller West', role: 'main', width: 2000 },
      { sourceId: '29934', name: 'Flur Keller Ost', role: 'main', width: 2000 },
      { sourceId: '30377', name: 'Flur Keller Treppe', role: 'main', width: 5400 },
      { sourceId: '75069', name: 'Flur EG West', role: 'main', width: 2000 },
      { sourceId: '79700', name: 'Flur EG Ost', role: 'main', width: 2000 },
      { sourceId: '81007', name: 'Flur EG Eingang', role: 'main', width: 5400 },
    ],
  },
  {
    id: 'ac20-fzk-haus',
    name: 'AC20 FZK Haus',
    file: 'AC20-FZK-Haus.ifc',
    spaces: 7,
    entityCounts: { IfcSpace: 7, IfcDoor: 5, IfcWindow: 11, IfcWallStandardCase: 13 },
    normalized: {
      rooms: 6,
      corridors: 1,
      byType: { office: 5, wc: 1 },
      byWcKind: { unclassified: 1 },
    },
    corridorWidthsMm: { min: 1588, median: 1588, max: 1588 },
    sampleRooms: [
      { name: 'Schlafzimmer', type: 'office', w: 5450, d: 4050 },
      { name: 'Bad', type: 'wc', w: 3710, d: 3370 },
      { name: 'Buero', type: 'office', w: 3710, d: 3500 },
      { name: 'Wohnen', type: 'office', w: 7005, d: 3710 },
      { name: 'Küche', type: 'office', w: 4395, d: 3710 },
      { name: 'Galerie', type: 'office', w: 11400, d: 9400 },
    ],
    sampleCorridors: [{ sourceId: '34191', name: 'Flur', role: 'side', width: 1588 }],
  },
];
