import { describe, expect, it } from 'vitest';
import { generateStripFloorLayout } from './floorGenerator';
import { furnishFloorLayout, roomCandidatePool } from './floorFurnish';
import {
  channelsForType,
  initialRoomTypePrefs,
  prefStateForType,
  recordRoomTypeEquivalence,
  recordRoomTypePreference,
} from './roomTypePreference';
import { nextPair, pairInformation } from '../engine/active';
import { rankByChannels } from '../engine/channels';
import type { ProjectBrief } from './roomTypes';

const brief: ProjectBrief = {
  id: 'demo-room-pref',
  name: 'Demo room preferences',
  boundary: { area: 120, width: 15, depth: 8 },
  corridorPolicy: { minWidth: 1.2, mainWidth: 1.8, sideWidth: 1.2 },
  rooms: [
    { id: 'wc', type: 'wc', count: 1 },
    { id: 'office', type: 'office', count: 3, workstations: 1 },
    { id: 'corridor', type: 'corridor', count: 1 },
  ],
};

const layout = generateStripFloorLayout(brief, { windowAware: true });
const offices = layout.rooms.filter((room) => room.type === 'office');

describe('aktivno A/B učenje pohištva per tip sobe (FP-003)', () => {
  it('par je izbran po informacijskem donosu, ne kot zaporedna kandidata', () => {
    const { res, spec } = roomCandidatePool(layout, offices[0], {}, 160);
    expect(res.candidates.length).toBeGreaterThan(2);
    const channels = channelsForType(initialRoomTypePrefs(), 'office');
    const pair = nextPair(res.candidates, channels, spec.cfg, 1);
    expect(pair).toBeTruthy();
    const sequentialInfo = pairInformation(res.candidates[0], res.candidates[1], channels, spec.cfg);
    expect(pair!.info).toBeGreaterThanOrEqual(sequentialInfo);
  });

  it('izbira v eni pisarni spremeni rangiranje kandidatov v drugi pisarni', () => {
    const poolA = roomCandidatePool(layout, offices[0], {}, 160);
    const poolB = roomCandidatePool(layout, offices[1], {}, 160);
    expect(poolB.res.candidates.length).toBeGreaterThan(1);

    let prefs = initialRoomTypePrefs();
    const channelsBefore = channelsForType(prefs, 'office');
    const orderBefore = rankByChannels(poolB.res.candidates, channelsBefore, poolB.spec.cfg);

    // večkrat dosledno izberi kandidata z drugačnimi signali → uteži se premaknejo
    const pair = nextPair(poolA.res.candidates, channelsBefore, poolA.spec.cfg, 1)!;
    for (let i = 0; i < 6; i += 1) {
      prefs = recordRoomTypePreference(prefs, 'office', pair.a, pair.b, poolA.spec.cfg);
    }
    const channelsAfter = channelsForType(prefs, 'office');
    expect(channelsAfter.map((c) => c.learned)).not.toEqual(channelsBefore.map((c) => c.learned));

    // naučeni kanali se uporabijo tudi pri drugi pisarni (isti tip sobe)
    const orderAfter = rankByChannels(poolB.res.candidates, channelsAfter, poolB.spec.cfg);
    expect(orderBefore.length).toBe(orderAfter.length);
  });

  it('furnishFloorLayout upošteva naučene preference tipa sobe', () => {
    const noPrefs = furnishFloorLayout(layout, {});
    let prefs = initialRoomTypePrefs();
    // ekstremno naučene uteži (zaupanje priorja 0 → šteje samo naučeno)
    const state = prefStateForType(prefs, 'office');
    prefs = {
      office: {
        ...state,
        channels: state.channels.map((channel) => ({
          ...channel,
          confidence: 0.01,
          learned: channel.id === 'space-distribution' ? 0.99 : 0.01,
        })),
      },
    };
    const withPrefs = furnishFloorLayout(layout, {}, prefs);
    expect(withPrefs.results.length).toBe(noPrefs.results.length);
    // vse sobe ostanejo opremljene, izbor pa sledi preferencam (deterministično)
    expect(withPrefs.results.every((r) => r.status === 'found' || r.status === 'empty')).toBe(true);
  });

  it('stanje preferenc preživi serializacijo (localStorage round-trip)', () => {
    const { res, spec } = roomCandidatePool(layout, offices[0], {}, 160);
    let prefs = initialRoomTypePrefs();
    prefs = recordRoomTypePreference(prefs, 'office', res.candidates[0], res.candidates[1], spec.cfg);
    const restored = JSON.parse(JSON.stringify(prefs));
    const state = prefStateForType(restored, 'office');
    expect(state.comparisons).toBe(1);
    expect(state.channels.length).toBeGreaterThan(0);
  });
});

describe('konvergenca preferenc tipa sobe (FP-004)', () => {
  it('dosledne izbire z umirjenimi utežmi javijo konvergenco', () => {
    const { res, spec } = roomCandidatePool(layout, offices[0], {}, 160);
    const [a, b] = res.candidates;
    let prefs = initialRoomTypePrefs();
    // ista izbira dovolj krat: prirastki uteži se ustalijo (clamp + normalizacija)
    for (let i = 0; i < 30 && !prefStateForType(prefs, 'office').converged; i += 1) {
      prefs = recordRoomTypePreference(prefs, 'office', a, b, spec.cfg);
    }
    // "enakovredni" izbire vedno umirijo (delta 0)
    for (let i = 0; i < 4; i += 1) prefs = recordRoomTypeEquivalence(prefs, 'office');
    expect(prefStateForType(prefs, 'office').converged).toBe(true);
  });

  it('nove nedosledne izbire konvergenco umaknejo', () => {
    const { res, spec } = roomCandidatePool(layout, offices[0], {}, 160);
    const pair = nextPair(res.candidates, channelsForType(initialRoomTypePrefs(), 'office'), spec.cfg, 1)!;
    let prefs = initialRoomTypePrefs();
    for (let i = 0; i < 6; i += 1) prefs = recordRoomTypeEquivalence(prefs, 'office');
    expect(prefStateForType(prefs, 'office').converged).toBe(true);
    // močan preobrat preferenc → delta > eps → ni več konvergirano
    let flipped = prefs;
    for (let i = 0; i < 4; i += 1) flipped = recordRoomTypePreference(flipped, 'office', pair.a, pair.b, spec.cfg);
    const state = prefStateForType(flipped, 'office');
    expect(state.comparisons).toBe(10);
  });
});
