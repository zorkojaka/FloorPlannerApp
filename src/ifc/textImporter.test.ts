import { describe, expect, it } from 'vitest';
import { decodeIfcText, parseIfcTextToNormalizedPlan, summarizeIfcText } from './textImporter';

const fixture = `
ISO-10303-21;
DATA;
#10= IFCQUANTITYAREA('GrossFloorArea',$,$,12.76,$);
#11= IFCQUANTITYLENGTH('GrossPerimeter',$,$,14.6,$);
#12= IFCELEMENTQUANTITY('q1',#1,'BaseQuantities',$,$,(#10,#11));
#20= IFCSPACE('guid',#1,'008',$,$,#1,#2,'WC Herren',.ELEMENT.,$,$);
#21= IFCRELDEFINESBYPROPERTIES('rel',#1,$,$,(#20),#12);
#30= IFCQUANTITYAREA('GrossFloorArea',$,$,18,$);
#31= IFCQUANTITYLENGTH('GrossPerimeter',$,$,18,$);
#32= IFCELEMENTQUANTITY('q2',#1,'BaseQuantities',$,$,(#30,#31));
#40= IFCSPACE('guid2',#1,'015',$,$,#1,#2,'Flur Ost',.ELEMENT.,$,$);
#41= IFCRELDEFINESBYPROPERTIES('rel2',#1,$,$,(#40),#32);
ENDSEC;
END-ISO-10303-21;
`;

describe('IFC text importer', () => {
  it('decodes IFC unicode escapes', () => {
    expect(decodeIfcText('Buero M\\X2\\00FC\\X0\\ller')).toBe('Buero Müller');
  });

  it('normalizes IFC spaces and corridor quantities', () => {
    const plan = parseIfcTextToNormalizedPlan(fixture, 'fixture');
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]).toMatchObject({ name: 'WC Herren', roomType: 'wc' });
    expect(plan.rooms[0].w).toBeCloseTo(4400, -2);
    expect(plan.rooms[0].d).toBeCloseTo(2900, -2);
    expect(plan.corridors).toEqual([{ sourceId: '40', name: 'Flur Ost', role: 'main', width: 3000 }]);
  });

  it('summarizes IFC entities', () => {
    const summary = summarizeIfcText(fixture);
    expect(summary.entityCounts.IFCSPACE).toBe(2);
    expect(summary.spaces).toBe(2);
    expect(summary.rooms).toBe(1);
    expect(summary.corridors).toBe(1);
  });
});
