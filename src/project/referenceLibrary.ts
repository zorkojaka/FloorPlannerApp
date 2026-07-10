import type { NormalizedIfcPlan } from '../ifc/normalizedPlan';
import {
  extractFloorStrategyObservations,
  induceFloorStrategyProfile,
  type FloorStrategyObservation,
  type FloorStrategyProfile,
} from '../ifc/floorStrategy';
import { observationsFromNormalizedPlan } from '../ifc/observations';
import { induceRules, type InducedRule, type ReferenceObservation } from '../rules/induction';
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

/** Envelope pravila pohištva, LOČENA per tip sobe. Pravila so podatki, ne koda. */
export type RoomRuleSets = Record<string, InducedRule[]>;

/**
 * Indukcija pravil pohištva iz knjižnice, LOČENO PER TIP SOBE: opazovanja sob
 * tega tipa se zberejo iz vseh referenc (tudi iz etažnih — njihove WC/pisarne
 * štejejo), nato obstoječa indukcija (min→jedro, mediana→halo, p90→nasičenje,
 * varianca→zaupanje). Zamenjava WC referenc spremeni samo WC pravila.
 */
// ── Holdout validacija etažne indukcije (FP-007, merilna os a) ────────────────
// Leave-one-out: profil se nauči na vseh etažnih referencah RAZEN ene, nato se
// preveri, kako dobro napove zadržano. Številka ujemanja za VSAK parameter.

export interface FloorHoldoutParameter {
  metric: FloorStrategyObservation['metric'];
  label: string;
  /** 0..1 — kako dobro se je profil (naučen brez zadržane reference) ujel z njo */
  match: number;
  samples: number;
}

export interface FloorHoldoutReport {
  referenceCount: number;
  /** povprečno ujemanje čez vse parametre */
  score: number;
  parameters: FloorHoldoutParameter[];
}

const HOLDOUT_METRIC_LABELS: Record<FloorStrategyObservation['metric'], string> = {
  'wc-cluster': 'WC gruča',
  'wc-dispersion': 'WC razpršenost',
  'internal-corridor-count': 'notranji hodniki',
  'corridor-width-main': 'širina glavnega hodnika',
  'corridor-width-side': 'širina stranskih hodnikov',
  'corridor-ratio': 'delež hodnikov',
};

/** predicted iz profila + način primerjave: relativno (mere) ali absolutno (deleži 0..1) */
function holdoutPrediction(profile: FloorStrategyProfile, metric: FloorStrategyObservation['metric'], actual: number): { predicted: number; actual: number; relative: boolean } {
  if (metric === 'wc-cluster') return { predicted: profile.preferClusteredWc, actual, relative: false };
  if (metric === 'wc-dispersion') return { predicted: profile.preferSpreadWc, actual, relative: false };
  if (metric === 'internal-corridor-count') return { predicted: profile.preferInternalCorridors, actual: Math.min(1, actual / 2), relative: false };
  if (metric === 'corridor-width-main') return { predicted: profile.mainCorridorWidth, actual, relative: true };
  if (metric === 'corridor-width-side') return { predicted: profile.sideCorridorWidth, actual, relative: true };
  return { predicted: profile.corridorRatio, actual, relative: false };
}

export function floorHoldoutReport(library: ReferenceLibrary): FloorHoldoutReport | null {
  const floors = referencesOfKind(library, 'floor');
  if (floors.length < 2) return null;

  const matchesByMetric = new Map<FloorStrategyObservation['metric'], number[]>();
  for (let held = 0; held < floors.length; held += 1) {
    const trainObservations = floors.filter((_, i) => i !== held).flatMap((ref) => extractFloorStrategyObservations(ref.plan));
    const profile = induceFloorStrategyProfile('holdout', trainObservations);
    const heldObservations = extractFloorStrategyObservations(floors[held].plan);

    const byMetric = new Map<FloorStrategyObservation['metric'], number[]>();
    for (const observation of heldObservations) {
      byMetric.set(observation.metric, [...(byMetric.get(observation.metric) || []), observation.value]);
    }
    for (const [metric, values] of byMetric) {
      const actualAvg = values.reduce((sum, value) => sum + value, 0) / values.length;
      const { predicted, actual, relative } = holdoutPrediction(profile, metric, actualAvg);
      const error = Math.abs(predicted - actual) / (relative ? Math.max(Math.abs(actual), 1) : 1);
      const match = Math.max(0, 1 - Math.min(1, error));
      matchesByMetric.set(metric, [...(matchesByMetric.get(metric) || []), match]);
    }
  }

  const parameters: FloorHoldoutParameter[] = [...matchesByMetric.entries()].map(([metric, matches]) => ({
    metric,
    label: HOLDOUT_METRIC_LABELS[metric],
    match: matches.reduce((sum, value) => sum + value, 0) / matches.length,
    samples: matches.length,
  }));
  const score = parameters.length ? parameters.reduce((sum, parameter) => sum + parameter.match, 0) / parameters.length : 0;
  return { referenceCount: floors.length, score, parameters };
}

export function roomRuleSetsFromLibrary(library: ReferenceLibrary): RoomRuleSets {
  const lib = normalizeReferenceLibrary(library);
  const byType = new Map<string, ReferenceObservation[]>();
  for (const ref of lib.references) {
    for (const observation of observationsFromNormalizedPlan(ref.plan)) {
      // hodniki so etažna pravila (širine), ne pravila pohištva v sobi
      if (!observation.roomType || observation.roomType === 'corridor') continue;
      byType.set(observation.roomType, [...(byType.get(observation.roomType) || []), observation]);
    }
  }
  const sets: RoomRuleSets = {};
  for (const [type, observations] of byType) sets[type] = induceRules(observations);
  return sets;
}
