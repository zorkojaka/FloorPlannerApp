import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import { extractFloorStrategyObservations, induceFloorStrategyProfile, type FloorStrategyProfile } from '../ifc/floorStrategy';
import { projectTrainingFromNormalizedPlan, type ProjectTrainingResult } from './projectTraining';

// Knjižnica referenčnih načrtov — enotno mesto za naložene načrte (AI-ekstrakcija,
// IFC, ročni JSON). Vsaka referenca ima TIP (wc/pisarna/etaža/proizvodnja); indukcija
// se preračuna iz trenutne vsebine knjižnice — dodajanje/odstranjevanje referenc
// spremeni pravila brez spremembe kode. Navaden JSON → localStorage zdaj, backend kasneje.

export type ReferenceKind = 'wc' | 'office' | 'floor' | 'production';

export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  wc: 'WC / sanitarije',
  office: 'Pisarna',
  floor: 'Cela etaža',
  production: 'Proizvodnja',
};

export interface PlanReference {
  id: string;
  name: string;
  kind: ReferenceKind;
  /** od kod je referenca prišla (za sledljivost/citiranje) */
  source: 'ai' | 'ifc' | 'manual';
  addedAt: string; // ISO datum
  plan: NormalizedIfcPlan;
}

export interface ReferenceLibrary {
  references: PlanReference[];
}

export function initialReferenceLibrary(): ReferenceLibrary {
  return { references: [] };
}

/** Migracija/obramba: zapis iz shrambe je lahko star ali okvarjen. */
export function normalizeReferenceLibrary(raw: Partial<ReferenceLibrary> | null | undefined): ReferenceLibrary {
  if (!raw || !Array.isArray(raw.references)) return initialReferenceLibrary();
  return { references: raw.references.filter((ref) => ref && ref.id && ref.plan && Array.isArray(ref.plan.rooms)) };
}

/** Heuristika tipa iz vsebine načrta — uporabnik jo lahko prepiše ob shranjevanju. */
export function inferReferenceKind(plan: NormalizedIfcPlan): ReferenceKind {
  const types = new Set(plan.rooms.map((room) => room.roomType));
  if ((plan.corridors || []).length > 0 || plan.rooms.length >= 3 || types.size > 1) return 'floor';
  if (types.has('wc')) return 'wc';
  return 'office';
}

export function addReference(
  library: ReferenceLibrary,
  input: { name?: string; kind?: ReferenceKind; source?: PlanReference['source']; plan: NormalizedIfcPlan },
  now: Date = new Date(),
): ReferenceLibrary {
  const lib = normalizeReferenceLibrary(library);
  const kind = input.kind ?? inferReferenceKind(input.plan);
  const name = input.name || input.plan.name || input.plan.sourceId || 'Referenca';
  const id = `${kind}-${input.plan.sourceId || 'ref'}-${lib.references.length + 1}-${now.getTime().toString(36)}`;
  return {
    references: [
      ...lib.references,
      { id, name, kind, source: input.source ?? 'manual', addedAt: now.toISOString(), plan: input.plan },
    ],
  };
}

export function removeReference(library: ReferenceLibrary, id: string): ReferenceLibrary {
  const lib = normalizeReferenceLibrary(library);
  return { references: lib.references.filter((ref) => ref.id !== id) };
}

export function referencesOfKind(library: ReferenceLibrary, kind: ReferenceKind): PlanReference[] {
  return normalizeReferenceLibrary(library).references.filter((ref) => ref.kind === kind);
}

/** Kratek povzetek reference za prikaz v knjižnici. */
export function referenceSummary(ref: PlanReference): string {
  const rooms = ref.plan.rooms.length;
  const corridors = (ref.plan.corridors || []).length;
  const elements = ref.plan.rooms.reduce((sum, room) => sum + (room.elements?.length || 0), 0);
  const parts = [`${rooms} prostorov`];
  if (corridors) parts.push(`${corridors} hodnikov`);
  if (elements) parts.push(`${elements} elementov`);
  return parts.join(' · ');
}

export interface LibraryFloorTraining {
  /** projektni trening (brief, cone) iz zadnje etažne reference */
  training: ProjectTrainingResult;
  /** strateški profil, induciran iz VSEH etažnih referenc skupaj */
  profile: FloorStrategyProfile;
  referenceCount: number;
}

/**
 * Etažni trening iz knjižnice: opazovanja VSEH referenc tipa 'floor' se združijo
 * v en strateški profil (več načrtov → trdnejša statistika), brief in cone pa
 * pridejo iz zadnje dodane etažne reference. Odstranitev reference spremeni
 * profil brez spremembe kode.
 */
export function floorTrainingFromLibrary(library: ReferenceLibrary): LibraryFloorTraining | null {
  const floors = referencesOfKind(library, 'floor');
  if (!floors.length) return null;
  const latest = floors[floors.length - 1];
  const observations = floors.flatMap((ref) => extractFloorStrategyObservations(ref.plan));
  const name = floors.length === 1 ? latest.name : `Knjižnica (${floors.length} načrtov)`;
  return {
    training: projectTrainingFromNormalizedPlan(latest.plan),
    profile: induceFloorStrategyProfile(name, observations),
    referenceCount: floors.length,
  };
}
