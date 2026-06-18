export interface JsonStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadJson<T>(storage: JsonStorage | undefined, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson<T>(storage: JsonStorage | undefined, key: string, value: T): void {
  if (!storage) return;
  storage.setItem(key, JSON.stringify(value));
}
