import { describe, it, expect } from 'vitest';
import type { ProgramInstance } from '../constraints/brief';
import { baseLib } from '../elements/library';
import { generateLayoutPool, searchLayouts } from './generator';
import { uid } from '../shared/math';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const lib = baseLib();
const fourUrinals = (): ProgramInstance[] => [
  { id: uid(), key: 'door', w: 800, dir: 'auto', wall: 'auto', hinge: 'auto' },
  { id: uid(), key: 'window' },
  { id: uid(), key: 'toilet' },
  { id: uid(), key: 'sink' },
  { id: uid(), key: 'urinal' },
  { id: uid(), key: 'urinal' },
  { id: uid(), key: 'urinal' },
  { id: uid(), key: 'urinal' },
];
const roomy = { W: 3200, D: 2600, wetWall: 'S' as const, minAisle: 800 };

describe('generator place-and-repair (popravek načina iskanja)', () => {
  it('NALOGA 2 — poln program (4 pisoarji + …) vrne VEČ veljavnih (prej čisto naključje: 0)', () => {
    const res = searchLayouts({ library: lib, program: fourUrinals(), cfg: roomy, soft: true, random: seeded(7) });
    expect(res.status).toBe('found');
    expect(res.candidates.length).toBeGreaterThan(1); // raznoliki kandidati, ne en
    expect(res.candidates.every((c) => c.ev.valid)).toBe(true); // pravila nedotaknjena — vsi veljavni
  });

  it('determinizem — isti seed → isti rezultat', () => {
    const a = generateLayoutPool({ library: lib, program: fourUrinals(), cfg: roomy, soft: true, random: seeded(11) });
    const b = generateLayoutPool({ library: lib, program: fourUrinals(), cfg: roomy, soft: true, random: seeded(11) });
    expect(a.length).toBe(b.length);
    expect(a.map((c) => Math.round(c.ev.score * 1000))).toEqual(b.map((c) => Math.round(c.ev.score * 1000)));
  });

  it('NALOGA 1 — DOKAZANA nemožnost = infeasible (ne "nisem našel")', () => {
    const tiny = searchLayouts({ library: lib, program: fourUrinals(), cfg: { W: 900, D: 900, wetWall: 'S', minAisle: 800 }, soft: true, random: seeded(1) });
    expect(tiny.status).toBe('infeasible');
    expect(tiny.reasons.length).toBeGreaterThan(0); // dokaz nemožnosti
    expect(tiny.candidates).toHaveLength(0);
  });

  it('NALOGA 1 — feasible vrne strukturiran izid (found/not-found + attempts)', () => {
    const res = searchLayouts({ library: lib, program: fourUrinals(), cfg: roomy, soft: true, random: seeded(3) });
    expect(['found', 'not-found']).toContain(res.status);
    expect(res.reasons).toHaveLength(0); // ni dokaza nemožnosti
    expect(res.attempts).toBeGreaterThan(0);
    expect(typeof res.expanded).toBe('boolean');
  });

  it('NALOGA 3 — varovalka: bazni poskus prazen → samodejno razširi in NAJDE (ne lažni "ni rešitve")', () => {
    // seed 1: 1 bazni poskus ne zadene → varovalka razširi na ×4 in najde rešitev
    const res = searchLayouts({ library: lib, program: fourUrinals(), cfg: roomy, soft: true, samples: 1, random: seeded(1) });
    expect(res.expanded).toBe(true); // razširilo se je
    expect(res.attempts).toBe(4); // bazni 1 → ×4 varovalka
    expect(res.candidates.length).toBeGreaterThan(0); // brez lažnega "ni rešitve"
    expect(res.status).toBe('found');
  });
});
