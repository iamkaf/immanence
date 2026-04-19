export function stableStringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}
