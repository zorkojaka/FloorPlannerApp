export type RuleScope = 'global' | 'room-type';

export interface Envelope {
  core: number;
  halo: number;
  sat: number;
  conf: number;
  scope: RuleScope;
}

export function isLowConfidence(envelope: Envelope, threshold = 0.5): boolean {
  return envelope.conf < threshold;
}
