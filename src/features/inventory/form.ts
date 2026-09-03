/**
 * 서버 액션 폼 파서 — 순수(서버 액션 파일은 `"use server"`라 동기 헬퍼를 export 할 수 없다 [[#119]]).
 * 값은 전부 trim, 빈 문자열은 null. 날짜는 `YYYY-MM-DD` 형식 + 실존(2026-13-45 거절)만 통과.
 */
export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(v: unknown): v is string {
  return typeof v === "string" && YMD_RE.test(v) && !Number.isNaN(Date.parse(v));
}

/** 문자열 칸(빈 값 → null). `max`를 넘으면 `{ error }`. */
export function textField(
  fd: FormData,
  key: string,
  label: string,
  max: number,
): { value: string | null } | { error: string } {
  const raw = fd.get(key);
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { value: null };
  if (s.length > max) return { error: `${label}은(는) ${max}자까지입니다` };
  return { value: s };
}

/** 날짜 칸(빈 값 → null). 형식이 틀리면 `{ error }`. */
export function dateField(fd: FormData, key: string, label: string): { value: string | null } | { error: string } {
  const raw = fd.get(key);
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return { value: null };
  if (!isYmd(s)) return { error: `${label} 날짜 형식이 올바르지 않습니다` };
  return { value: s };
}

/** 0 이상의 정수 칸. */
export function intField(fd: FormData, key: string, label: string): { value: number } | { error: string } {
  const raw = fd.get(key);
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,9}$/.test(s)) return { error: `${label}은(는) 0 이상의 정수여야 합니다` };
  return { value: Number(s) };
}

export function idField(fd: FormData, key = "id"): string | null {
  const raw = fd.get(key);
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null;
}
