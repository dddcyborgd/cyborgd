export function clonePlainObject<T>(value: T): T {
  return structuredClone(value);
}
