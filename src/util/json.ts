export function stableStringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
