export function registerUnique<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  label: string,
): void {
  if (map.has(key)) {
    throw new Error(`Duplicate ${label}: ${key}`);
  }
  map.set(key, value);
}

