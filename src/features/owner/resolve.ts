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

/** 저장값(부분) + 테넌트 메타 → 완전한 설정. name 미입력 시 테넌트 학원명으로 폴백. */
export function resolveSettings(stored: unknown, tenant: { name: string }): TenantSettings {
  const merged = deepMerge(DEFAULT_SETTINGS, stored);
  return {
    ...merged,
    profile: { ...merged.profile, name: merged.profile.name || tenant.name },
  };
}
