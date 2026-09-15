export function resolveFocusKey(
  prev: string | null,
  pills: { key: string; n: number }[],
): string | null {
  if (pills.length === 0) return null;
  if (prev && pills.some((p) => p.key === prev)) return prev;
  return pills.reduce((a, b) => (a.n <= b.n ? a : b)).key;
}

export function cycleHelpKey(keys: string[], current: string, dir: 1 | -1): string {
  if (keys.length === 0) return current;
  const i = keys.indexOf(current);
  if (i < 0) return keys[0]!;
  return keys[(i + dir + keys.length) % keys.length]!;
}

export function helpKeyForDigit(pills: { key: string; n: number }[], digit: number): string | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null;
  return pills.find((p) => p.n === digit)?.key ?? null;
}
