import type { RoomType } from '../project/roomTypes';
import type { NormalizedIfcCorridor, NormalizedIfcPlan, NormalizedIfcRoom } from './normalizedPlan';

export interface IfcTextImportSummary {
  entityCounts: Record<string, number>;
  spaces: number;
  rooms: number;
  corridors: number;
}

interface StepRecord {
  id: string;
  type: string;
  args: string[];
}

interface SpaceMetrics {
  area?: number;
  perimeter?: number;
  height?: number;
}

export function summarizeIfcText(text: string): IfcTextImportSummary {
  const entityCounts: Record<string, number> = {};
  for (const match of text.matchAll(/\b(IFC[A-Z0-9_]+)\s*\(/g)) {
    entityCounts[match[1]] = (entityCounts[match[1]] || 0) + 1;
  }
  const plan = parseIfcTextToNormalizedPlan(text);
  return {
    entityCounts,
    spaces: entityCounts.IFCSPACE || 0,
    rooms: plan.rooms.length,
    corridors: plan.corridors?.length || 0,
  };
}

export function parseIfcTextToNormalizedPlan(text: string, sourceId = 'ifc-import'): NormalizedIfcPlan {
  const records = parseStepRecords(text);
  const recordById = new Map(records.map((record) => [record.id, record]));
  const quantitySetById = new Map<string, Record<string, number>>();
  const relatedPropertiesByObject = new Map<string, string[]>();

  for (const record of records) {
    if (record.type === 'IFCELEMENTQUANTITY') {
      const quantityRefs = parseRefList(record.args[5] || '');
      const quantities: Record<string, number> = {};
      for (const ref of quantityRefs) {
        const quantity = recordById.get(ref);
        if (!quantity || !quantity.type.startsWith('IFCQUANTITY')) continue;
        const name = decodeIfcText(unquote(quantity.args[0] || ''));
        const value = Number((quantity.args[3] || '').replace(/^\+/, ''));
        if (name && Number.isFinite(value)) quantities[name] = value;
      }
      quantitySetById.set(record.id, quantities);
    }
    if (record.type === 'IFCRELDEFINESBYPROPERTIES') {
      const objectRefs = parseRefList(record.args[4] || '');
      const propertyRef = (record.args[5] || '').trim();
      for (const objectRef of objectRefs) {
        const current = relatedPropertiesByObject.get(objectRef) || [];
        current.push(propertyRef);
        relatedPropertiesByObject.set(objectRef, current);
      }
    }
  }

  const rooms: NormalizedIfcRoom[] = [];
  const corridors: NormalizedIfcCorridor[] = [];
  for (const record of records.filter((item) => item.type === 'IFCSPACE')) {
    const name = decodeIfcText(unquote(record.args[7] || record.args[2] || record.id));
    const metrics = metricsForSpace(record.id, relatedPropertiesByObject, quantitySetById);
    const dimensions = dimensionsFromMetrics(metrics);
    const roomType = classifyRoomType(name);
    if (roomType === 'corridor') {
      corridors.push({
        sourceId: record.id.slice(1),
        name,
        role: corridorRole(name, dimensions),
        width: Math.round(Math.min(dimensions.w, dimensions.d)),
      });
    } else {
      rooms.push({
        sourceId: record.id.slice(1),
        name,
        roomType,
        w: Math.round(dimensions.w),
        d: Math.round(dimensions.d),
        elements: [],
      });
    }
  }

  return {
    sourceId,
    name: sourceId,
    corridors,
    rooms,
  };
}

function parseStepRecords(text: string): StepRecord[] {
  const records: StepRecord[] = [];
  for (const match of text.matchAll(/(#\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([\s\S]*?)\);/g)) {
    records.push({ id: match[1], type: match[2], args: splitStepArgs(match[3]) });
  }
  return records;
}

function splitStepArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let quote = false;
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'") {
      current += ch;
      if (raw[i + 1] === "'") {
        current += raw[++i];
      } else {
        quote = !quote;
      }
      continue;
    }
    if (!quote) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  args.push(current.trim());
  return args;
}

function parseRefList(raw: string): string[] {
  return [...raw.matchAll(/#\d+/g)].map((match) => match[0]);
}

function metricsForSpace(spaceId: string, relations: Map<string, string[]>, quantitySets: Map<string, Record<string, number>>): SpaceMetrics {
  const allQuantities = (relations.get(spaceId) || []).flatMap((propertyId) => {
    const quantities = quantitySets.get(propertyId);
    return quantities ? Object.entries(quantities) : [];
  });
  const metricValue = (patterns: RegExp[]) => {
    const found = allQuantities.find(([name]) => patterns.some((pattern) => pattern.test(name)));
    return found ? found[1] : undefined;
  };
  return {
    area: metricValue([/GrossFloorArea/i, /NetFloorArea/i, /Fl.che/i, /Grundfl.che/i]),
    perimeter: metricValue([/GrossPerimeter/i, /NetPerimeter/i, /^Umfang$/i, /Nettoumfang/i]),
    height: metricValue([/^Height$/i, /NetHeight/i, /H.he/i]),
  };
}

function dimensionsFromMetrics(metrics: SpaceMetrics): { w: number; d: number; h?: number } {
  const area = metrics.area && metrics.area > 0 ? metrics.area : 9;
  const perimeter = metrics.perimeter && metrics.perimeter > 0 ? metrics.perimeter : undefined;
  if (!perimeter) {
    const side = Math.sqrt(area) * 1000;
    return { w: side, d: side, h: metrics.height ? metrics.height * 1000 : undefined };
  }
  const sum = perimeter / 2;
  const discriminant = Math.max(0, sum * sum - 4 * area);
  const a = (sum + Math.sqrt(discriminant)) / 2;
  const b = Math.max(0.5, sum - a);
  return { w: Math.max(a, b) * 1000, d: Math.min(a, b) * 1000, h: metrics.height ? metrics.height * 1000 : undefined };
}

function classifyRoomType(name: string): RoomType {
  const normalized = name.toLocaleLowerCase('de-DE');
  if (/\b(wc|toilet|toilette|sanit.r|bad)\b/.test(normalized)) return 'wc';
  if (/\b(flur|gang|korridor|corridor|hall|treppe)\b/.test(normalized)) return 'corridor';
  return 'office';
}

function corridorRole(name: string, dimensions: { w: number; d: number }): 'main' | 'side' {
  const normalized = name.toLocaleLowerCase('de-DE');
  const width = Math.min(dimensions.w, dimensions.d);
  if (/\b(main|haupt|west|ost)\b/.test(normalized)) return 'main';
  return width >= 1800 ? 'main' : 'side';
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("'") || !trimmed.endsWith("'")) return trimmed === '$' ? '' : trimmed;
  return trimmed.slice(1, -1).replace(/''/g, "'");
}

export function decodeIfcText(value: string): string {
  return value.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex: string) => {
    const chars: string[] = [];
    for (let i = 0; i < hex.length; i += 4) chars.push(String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)));
    return chars.join('');
  });
}
