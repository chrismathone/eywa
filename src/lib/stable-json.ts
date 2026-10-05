/**
 * 객체 키 순서와 무관한 직렬화 — "같은 값인가"를 문자열로 비교할 때 쓴다.
 * jsonb는 키 순서를 바꿔 돌려주므로 `JSON.stringify`를 그대로 비교하면 안 바뀐 값이 바뀐 것으로 잡힌다.
 * 배열 순서는 유지한다(순서가 의미인 값이 많다). `undefined` 속성은 JSON처럼 빠진다.
 */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, sortKeysDeep(source[key])]));
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
