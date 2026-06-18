export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}
