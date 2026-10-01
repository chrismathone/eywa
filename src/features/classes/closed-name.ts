import { normalizeClassName } from "./class-name";

/** Strip only our old/new archive suffixes; preserve legitimate parentheses in the class name. */
export function originalClassName(name: string) {
  let base = normalizeClassName(name);
  const suffix = /\s*\(~(?:\d{2}\.\d{2}\.\d{2}|\d{4}-\d{2}(?:-\d{2})?|종강)\)(?: \d+)?$/;
  while (suffix.test(base)) base = base.replace(suffix, "").trim();
  return base;
}
export function closedClassNameBase(name: string, date: string | null) {
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
  )
    throw new Error("종강일을 확인해 주세요.");
  const stamp = date ? date.slice(2).replaceAll("-", ".") : "종강";
  return `${originalClassName(name)} (~${stamp})`;
}
/** Bounded by the existing name count; no fixed retry limit and no per-candidate database round trips. */
export function nextClosedClassName(name: string, date: string, taken: Iterable<string>) {
  const used = new Set([...taken].map(normalizeClassName));
  const base = closedClassNameBase(name, date);
  let result = base;
  for (let n = 2; used.has(result); n++) result = `${base} ${n}`;
  return result;
}
