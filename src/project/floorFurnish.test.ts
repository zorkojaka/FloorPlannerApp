import { describe, expect, it } from 'vitest';
import { furnishFloorLayout } from './floorFurnish';
import { generateStripFloorLayout } from './floorGenerator';
import type { ProjectBrief } from './roomTypes';

const BRIEF: ProjectBrief = {
  id: 'f', name: 'F', boundary: { area: 220, width: 22, depth: 10 },
  entrances: [{ id: 'e', wall: 'S', position: 0.5, width: 1.2 }],
  corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
  rooms: [
    { id: 'office', type: 'office', count: 2 },
    { id: 'wc-men', type: 'wc', wcKind: 'male', count: 1 },
    { id: 'corridor', type: 'corridor', count: 1 },
  ],
};

describe('furnishFloorLayout per-soba override', () => {
  const layout = generateStripFloorLayout(BRIEF);
  const firstOffice = layout.rooms.find((r) => r.type === 'office')!;

  it('deluje s starim string-preset zapisom (nazaj združljivo)', () => {
    const f = furnishFloorLayout(layout, { [firstOffice.id]: 'empty' });
    const res = f.results.find((r) => r.room.id === firstOffice.id)!;
    expect(res.presetId).toBe('empty');
    // prazen preset → samo vrata
    expect(res.items.every((it) => it.kind === 'door')).toBe(true);
  });

  it('sprejme override objekt s presetom in semenom (A/B različica)', () => {
    const a = furnishFloorLayout(layout, { [firstOffice.id]: { presetId: 'office', seed: 0 } });
    const b = furnishFloorLayout(layout, { [firstOffice.id]: { presetId: 'office', seed: 1 } });
    const itemsA = a.results.find((r) => r.room.id === firstOffice.id)!.items;
    const itemsB = b.results.find((r) => r.room.id === firstOffice.id)!.items;
    expect(itemsA.length).toBeGreaterThan(0);
    // različno seme → (praviloma) drugačna postavitev
    expect(JSON.stringify(itemsA)).not.toBe(JSON.stringify(itemsB));
  });

  it('upošteva prepovedano cono (zones)', () => {
    const f = furnishFloorLayout(layout, {
      [firstOffice.id]: { presetId: 'office', zones: [{ x: 0, y: 0, w: Math.round(firstOffice.w * 1000), h: 400 }] },
    });
    const res = f.results.find((r) => r.room.id === firstOffice.id)!;
    // pohištvo (ne-vrata) se ne sme začeti znotraj prepovedanega pasu pri vrhu sobe
    const furniture = res.items.filter((it) => it.kind !== 'door');
    for (const it of furniture) expect(it.y - firstOffice.y).toBeGreaterThanOrEqual(0.4 - 0.001);
  });
});
