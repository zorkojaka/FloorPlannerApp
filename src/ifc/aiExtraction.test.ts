import { describe, it, expect } from 'vitest';
import { parseAiExtractedPlan, stripToJson } from './aiExtraction';
import { buildExtractionRequest, textFromResponse, ANTHROPIC_MESSAGES_URL } from './claudeExtraction';
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

  it('izlušči JSON iz ovitega odgovora in prebere bbox', () => {
    const wrapped = 'Tukaj je načrt:\n```json\n{"rooms":[{"roomType":"office","w":4000,"d":4000,"bbox":{"x":0.1,"y":0.2,"w":0.3,"h":0.25}}]}\n```';
    const plan = parseAiExtractedPlan(wrapped);
    expect(plan.rooms[0].bbox).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.25 });
  });

  it('bbox se sklampa na 0..1, neveljaven pa izpusti', () => {
    const plan = parseAiExtractedPlan('{"rooms":[{"roomType":"office","w":1,"d":1,"bbox":{"x":-1,"y":0.5,"w":2,"h":0.3}},{"roomType":"wc","w":1,"d":1,"bbox":{"x":"a"}}]}');
    expect(plan.rooms[0].bbox).toEqual({ x: 0, y: 0.5, w: 1, h: 0.3 });
    expect(plan.rooms[1].bbox).toBeUndefined();
  });
});

describe('stripToJson', () => {
  it('izlušči objekt med prvim { in zadnjim }', () => {
    expect(stripToJson('bl {"a":1} konec')).toBe('{"a":1}');
  });
  it('vrže brez objekta', () => {
    expect(() => stripToJson('brez json')).toThrow();
  });
});

describe('buildExtractionRequest', () => {
  it('sestavi Anthropic zahtevek s sliko in glavo za brskalnik', () => {
    const req = buildExtractionRequest('sk-test', { base64: 'AAAA', mediaType: 'image/png' });
    expect(req.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(req.headers['x-api-key']).toBe('sk-test');
    expect(req.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(req.body);
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[0].source.media_type).toBe('image/png');
  });

  it('PDF pošlje kot document blok', () => {
    const req = buildExtractionRequest('sk-test', { base64: 'AAAA', mediaType: 'application/pdf' });
    const body = JSON.parse(req.body);
    expect(body.messages[0].content[0].type).toBe('document');
    expect(body.messages[0].content[0].source.media_type).toBe('application/pdf');
  });
});

describe('textFromResponse', () => {
  it('združi besedilne bloke', () => {
    expect(textFromResponse({ content: [{ type: 'text', text: '{"a":1}' }, { type: 'text', text: '' }] })).toBe('{"a":1}');
  });
  it('vrže brez content polja', () => {
    expect(() => textFromResponse({})).toThrow();
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
