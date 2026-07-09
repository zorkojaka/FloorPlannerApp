import { describe, it, expect } from 'vitest';
import { parseAiExtractedPlan } from './aiExtraction';
import { projectTrainingFromNormalizedPlan } from '../project/projectTraining';

const SAMPLE = JSON.stringify({
  name: 'Testni tloris',
  corridors: [
    { name: 'Glavni', role: 'main', width: 2000 },
    { name: 'Stranski', role: 'side', width: 1300 },
  ],
  rooms: [
    { name: 'Pisarna 1', roomType: 'office', w: 4200, d: 5000 },
    { name: 'Pisarna 2', roomType: 'office', w: 4000, d: 5000 },
    { name: 'WC M', roomType: 'wc', wcKind: 'male', w: 2400, d: 2200 },
    { name: 'WC Ž', roomType: 'wc', wcKind: 'female', w: 2400, d: 2200 },
  ],
});

describe('parseAiExtractedPlan', () => {
  it('normalizira veljaven JSON', () => {
    const plan = parseAiExtractedPlan(SAMPLE);
    expect(plan.rooms).toHaveLength(4);
    expect(plan.corridors).toHaveLength(2);
    expect(plan.rooms[0].roomType).toBe('office');
    expect(plan.rooms[2].wcKind).toBe('male');
    expect(plan.rooms[0].w).toBe(4200);
  });

  it('zavrne JSON brez sob', () => {
    expect(() => parseAiExtractedPlan('{"rooms":[]}')).toThrow();
  });

  it('zavrne neveljaven roomType', () => {
    expect(() => parseAiExtractedPlan('{"rooms":[{"roomType":"kitchen","w":1,"d":1}]}')).toThrow();
  });

  it('zavrne nepozitivne mere', () => {
    expect(() => parseAiExtractedPlan('{"rooms":[{"roomType":"office","w":0,"d":3000}]}')).toThrow();
  });
});

describe('projectTrainingFromNormalizedPlan', () => {
  it('sestavi brief in profil iz AI-načrta', () => {
    const training = projectTrainingFromNormalizedPlan(parseAiExtractedPlan(SAMPLE));
    expect(training.evidence.office).toBe(2);
    expect(training.evidence.wc).toBe(2);
    expect(training.evidence.mainCorridorMm).toBe(2000);
    expect(training.evidence.sideCorridorMm).toBe(1300);
    // program vsebuje pisarne + M/Ž WC + hodnik
    const types = training.brief.rooms.map((room) => `${room.type}:${room.wcKind ?? ''}`);
    expect(types).toContain('office:');
    expect(types).toContain('wc:male');
    expect(types).toContain('wc:female');
    expect(training.brief.boundary.area).toBeGreaterThan(0);
  });
});
