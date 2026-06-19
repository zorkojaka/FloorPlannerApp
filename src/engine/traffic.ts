// Profil prometa (Nadgradnja 5.0): kaj se giblje po poti. Človeški kvader iz 3.0
// je samo en prednastavljen profil (pešec). Isti engine raztegne od WC-ja (pešec)
// do proizvodne linije (viličar, paleta) — ista mašina, drug profil.

export interface TrafficProfile {
  id: string;
  name: string;
  w: number; // širina enote (mm) — nastavljivo
  d: number; // dolžina enote (mm) — nastavljivo
  turningRadius: number; // radij obračanja (mm); 0 = obrne se na mestu (pešec)
}

export const TRAFFIC_PROFILES: Record<string, TrafficProfile> = {
  pedestrian: { id: 'pedestrian', name: 'pešec', w: 600, d: 400, turningRadius: 0 },
  pair: { id: 'pair', name: 'srečanje dveh', w: 1200, d: 400, turningRadius: 0 },
  cart: { id: 'cart', name: 'voziček', w: 700, d: 1000, turningRadius: 0 },
  forklift: { id: 'forklift', name: 'viličar', w: 1200, d: 2400, turningRadius: 1800 },
  pallet: { id: 'pallet', name: 'paleta', w: 1200, d: 1200, turningRadius: 0 },
};

export const PEDESTRIAN = TRAFFIC_PROFILES.pedestrian;

/**
 * Zahtevana širina poti za rang 1 (prehodnost): širina enote profila. Uporabnik
 * lahko zahteva širše od minimuma (vzvod), zato `extra` (mm) prišteje.
 */
export function pathWidthFor(profile: TrafficProfile, extra = 0): number {
  return profile.w + Math.max(0, extra);
}

/**
 * Rang 2 — "da se dva srečata": najožja točka mora prenesti dva profila vzporedno.
 */
export function meetingWidthFor(profile: TrafficProfile): number {
  return pathWidthFor(profile) * 2;
}

export function trafficProfile(id: string | undefined): TrafficProfile {
  return (id && TRAFFIC_PROFILES[id]) || PEDESTRIAN;
}
