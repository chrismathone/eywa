// 저장된 부분 설정(jsonb)을 DEFAULT_SETTINGS에 deep-merge해 "완전한" 설정으로 해석.
// 배열·원시는 저장값이 있으면 교체, 객체는 재귀 병합. 기본 객체는 절대 변형하지 않는다(공유 참조).
import { DEFAULT_SETTINGS } from "./defaults";
import type { TenantSettings } from "./settings-types";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, stored: unknown): T {
  if (!isPlainObject(base)) {
    return stored === undefined || stored === null ? base : (stored as T);
  }
  if (!isPlainObject(stored)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out as T;
}

// 공휴일 역호환 — 옛 저장형식 string[]("YYYY-MM-DD")를 {date,name}로 승격. 신형식 객체는 그대로.
// (deepMerge는 배열을 통째 교체하므로 옛 데이터가 그대로 흘러옴 → 여기서 형태 보장.)
function normalizeHolidays(arr: unknown): { date: string; name: string }[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((h) => {
      if (typeof h === "string") return { date: h, name: "" };
      if (h && typeof h === "object" && typeof (h as { date?: unknown }).date === "string") {
        const o = h as { date: string; name?: unknown };
        return { date: o.date, name: typeof o.name === "string" ? o.name : "" };
      }
      return null;
    })
    .filter((h): h is { date: string; name: string } => h !== null);
}

/** 저장값(부분) + 테넌트 메타 → 완전한 설정. name 미입력 시 테넌트 학원명으로 폴백. */
export function resolveSettings(stored: unknown, tenant: { name: string }): TenantSettings {
  const merged = deepMerge(DEFAULT_SETTINGS, stored);
  return {
    ...merged,
    profile: { ...merged.profile, name: merged.profile.name || tenant.name },
    operations: { ...merged.operations, holidays: normalizeHolidays(merged.operations.holidays) },
  };
}
