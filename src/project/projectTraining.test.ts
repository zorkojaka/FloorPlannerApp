import { describe, expect, it } from 'vitest';
import { IFC_REFERENCE_SETS } from '../training/ifcReferenceSets';
import { generateFloorLayoutPool } from './floorGenerator';
import { projectTrainingFromIfcSummary } from './projectTraining';

describe('project training from IFC summaries', () => {
  it('turns the institute IFC summary into a floor project brief', () => {
    const training = projectTrainingFromIfcSummary(IFC_REFERENCE_SETS[0]);
    expect(training.evidence).toMatchObject({ rooms: 69, corridors: 13, wc: 8, office: 61, mainCorridorMm: 2000 });
    expect(training.brief.rooms.find((room) => room.id === 'wc-men')).toMatchObject({ type: 'wc', wcKind: 'male', count: 4 });
    expect(training.brief.rooms.find((room) => room.id === 'wc-women')).toMatchObject({ type: 'wc', wcKind: 'female', count: 4 });
    expect(training.brief.rooms.find((room) => room.id === 'office')).toMatchObject({ type: 'office', count: 61 });
    expect(training.brief.corridorPolicy?.mainWidth).toBe(2);
    expect(training.profile.mainCorridorWidth).toBeGreaterThanOrEqual(2000);
    expect(generateFloorLayoutPool(training.brief).some((layout) => layout.warnings.length === 0)).toBe(true);
  });

  it('turns the FZK Haus IFC summary into a smaller project brief', () => {
    const training = projectTrainingFromIfcSummary(IFC_REFERENCE_SETS[1]);
    expect(training.evidence).toMatchObject({ rooms: 6, corridors: 1, wc: 1, office: 5 });
    expect(training.brief.rooms.find((room) => room.id === 'wc-unisex')).toMatchObject({ type: 'wc', wcKind: 'unisex', count: 1 });
    expect(training.brief.corridorPolicy?.mainWidth).toBe(1.6);
    expect(training.brief.boundary.area).toBeLessThan(300);
  });
});
