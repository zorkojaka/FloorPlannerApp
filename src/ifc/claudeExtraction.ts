/**
 * Prava AI-ekstrakcija: sliko/PDF tlorisa pošljemo Claudu (vision) neposredno iz
 * brskalnika in dobimo strukturiran NormalizedIfcPlan. Ker je aplikacija statična
 * (brez backenda), kličemo Anthropic API direktno z uporabnikovim ključem in glavo
 * `anthropic-dangerous-direct-browser-access`. Ključ ostane v uporabnikovem brskalniku.
 *
 * Gradnik zahtevka (`buildExtractionRequest`) je čista funkcija — testabilna brez mreže.
 */

import { AI_EXTRACTION_PROMPT, parseAiExtractedPlan } from './aiExtraction';
import type { NormalizedIfcPlan } from './normalizedPlan';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_EXTRACTION_MODEL = 'claude-opus-4-8';

export type MediaKind = 'image' | 'pdf';

export interface ExtractionSource {
  /** čisti base64 (brez data: predpone) */
  base64: string;
  /** npr. image/png, image/jpeg, image/webp ali application/pdf */
  mediaType: string;
}

export interface ExtractionRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Zgradi HTTP zahtevek za Claude vision ekstrakcijo (brez klica). */
export function buildExtractionRequest(apiKey: string, source: ExtractionSource, model = DEFAULT_EXTRACTION_MODEL): ExtractionRequest {
  const isPdf = source.mediaType === 'application/pdf';
  const mediaBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: source.base64 } }
    : { type: 'image', source: { type: 'base64', media_type: source.mediaType, data: source.base64 } };
  return {
    url: ANTHROPIC_MESSAGES_URL,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        { role: 'user', content: [mediaBlock, { type: 'text', text: AI_EXTRACTION_PROMPT }] },
      ],
    }),
  };
}

/** Iz odgovora Anthropic Messages API sestavi golo besedilo. */
export function textFromResponse(data: unknown): string {
  const content = (data as { content?: Array<{ type: string; text?: string }> })?.content;
  if (!Array.isArray(content)) throw new Error('Odgovor nima polja "content".');
  return content.filter((block) => block.type === 'text').map((block) => block.text || '').join('\n').trim();
}

/** Pokliči Claude vision in vrni razčlenjen načrt + surovo besedilo odgovora. */
export async function extractPlanWithClaude(
  apiKey: string,
  source: ExtractionSource,
  model = DEFAULT_EXTRACTION_MODEL,
  fetchImpl: typeof fetch = fetch,
): Promise<{ plan: NormalizedIfcPlan; raw: string }> {
  if (!apiKey) throw new Error('Manjka API ključ.');
  const request = buildExtractionRequest(apiKey, source, model);
  const response = await fetchImpl(request.url, { method: 'POST', headers: request.headers, body: request.body });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const err = await response.json();
      detail = err?.error?.message || detail;
    } catch { /* obdrži HTTP status */ }
    throw new Error(`Claude API napaka: ${detail}`);
  }
  const data = await response.json();
  const raw = textFromResponse(data);
  return { plan: parseAiExtractedPlan(raw), raw };
}

/** Preberi File (slika/PDF) v čisti base64 + mediaType (za brskalnik). */
export function fileToSource(file: File): Promise<ExtractionSource> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Branje datoteke ni uspelo.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) return reject(new Error('Neveljavna vsebina datoteke.'));
      resolve({ base64: result.slice(comma + 1), mediaType: file.type || 'image/png' });
    };
    reader.readAsDataURL(file);
  });
}
