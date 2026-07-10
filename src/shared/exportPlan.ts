/**
 * Izvoz končnega načrta etaže (Korak 4 — Pregled): strukturiran JSON in samostojna SVG slika.
 * Čiste funkcije (`planToJson`, `svgMarkup`) so testabilne; `downloadBlob`/`svgToString`
 * so tanka brskalniška ovojnica okoli njiju.
 */

import type { FloorLayout } from '../project/floorGenerator';
import type { FloorFurnishing } from '../project/floorFurnish';
import type { FloorLayers } from '../project/floorLayers';

export interface ExportedPlan {
  name: string;
  generatedAt: string;
  boundary: FloorLayout['boundary'];
  corridors: Array<{ id: string; x: number; y: number; w: number; d: number }>;
  rooms: Array<{
    id: string;
    name: string;
    type: string;
    wcKind?: string;
    x: number;
    y: number;
    w: number;
    d: number;
    doorSide?: string;
    hasWindow?: boolean;
    zone?: string;
  }>;
  furniture: FloorFurnishing['items'];
  zoneByRoom?: Record<string, string>;
}

/** Sestavi strojno berljiv načrt (metri) iz izbrane etaže + opreme + con. */
export function planToJson(layout: FloorLayout, furnishing: FloorFurnishing, layers: FloorLayers | null): ExportedPlan {
  const corridors = [layout.corridor, ...(layout.corridorLinks || [])].filter(Boolean);
  return {
    name: `Etaža ${layout.boundary.width}×${layout.boundary.depth} m`,
    generatedAt: new Date().toISOString(),
    boundary: layout.boundary,
    corridors: corridors.map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, d: c.d })),
    rooms: layout.rooms.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      wcKind: r.wcKind,
      x: r.x,
      y: r.y,
      w: r.w,
      d: r.d,
      doorSide: r.doorSide,
      hasWindow: r.hasWindow,
      zone: r.zone,
    })),
    furniture: furnishing.items,
    zoneByRoom: layers?.zoneByRoom,
  };
}

/** Iz `<svg …>` označbe naredi samostojno SVG datoteko (xmlns + eksplicitni width/height iz viewBox). */
export function svgMarkup(outerHTML: string, viewBox: string | null): string {
  let markup = outerHTML;
  if (!/xmlns=/.test(markup)) markup = markup.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (viewBox && !/\swidth=/.test(markup)) {
    const parts = viewBox.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const scale = 40; // px na metr — dovolj oster izvoz
      markup = markup.replace('<svg', `<svg width="${Math.round(parts[2] * scale)}" height="${Math.round(parts[3] * scale)}"`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}

/** Samostojni SVG string iz živega elementa. */
export function svgToString(el: SVGSVGElement): string {
  return svgMarkup(el.outerHTML, el.getAttribute('viewBox'));
}

/** Sproži prenos datoteke v brskalniku. */
export function downloadBlob(filename: string, mime: string, text: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
