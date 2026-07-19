/**
 * 반 공통 서술(G6) 클라 스토어 — sessionStorage(날짜 키) + useSyncExternalStore 스냅샷.
 * 서술은 **생성 재료**(기록 아님)라 세션 수명이면 충분 — 새로고침만 방어하고 탭 닫으면 소멸(의도).
 * ⚠️ lazy useState 초기값에서 storage 읽기 = hydration 크래시(#75), effect setState = lint 금지(#25)
 * → useSyncExternalStore가 유일한 정석(teacher-alert 선례). 스냅샷 객체는 캐시로 참조 동일성 보장
 * (매 호출 새 객체면 무한 리렌더). 서버 스냅샷 = 빈 상수(SSR엔 서술 없음 — 배지·생성은 클라 행위).
 */

export type ClassNarratives = Record<string, string>; // 반 이름 → 서술

const EMPTY: ClassNarratives = {};
const cache = new Map<string, ClassNarratives>();
const listeners = new Set<() => void>();

function storageKey(dateIso: string): string {
  return `eywa-onescreen-classctx:${dateIso}`;
}

function readFromStorage(dateIso: string): ClassNarratives {
  try {
    const raw = window.sessionStorage.getItem(storageKey(dateIso));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return EMPTY;
    const out: ClassNarratives = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>))
      if (typeof v === "string" && v.trim()) out[k] = v;
    return Object.keys(out).length ? out : EMPTY;
  } catch {
    return EMPTY; // 파손·접근 불가(시크릿 등) = 서술 없음(생성 재료라 잃어도 무해)
  }
}

export function subscribeClassNarratives(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** 스냅샷 — 같은 날짜·같은 내용이면 같은 참조(캐시). 클라 전용(서버에선 getServerClassNarratives). */
export function getClassNarratives(dateIso: string): ClassNarratives {
  const cached = cache.get(dateIso);
  if (cached) return cached;
  const fresh = readFromStorage(dateIso);
  cache.set(dateIso, fresh);
  return fresh;
}

/** SSR 스냅샷 — 항상 빈 값(서술은 클라 세션 소유). */
export function getServerClassNarratives(): ClassNarratives {
  return EMPTY;
}

/** 서술 저장(빈 문자열 = 삭제). storage + 캐시 갱신 후 구독자 통지. */
export function setClassNarrative(dateIso: string, className: string, text: string): void {
  const cur = getClassNarratives(dateIso);
  const next: ClassNarratives = { ...cur };
  if (text.trim()) next[className] = text.trim();
  else delete next[className];
  cache.set(dateIso, Object.keys(next).length ? next : EMPTY);
  try {
    if (Object.keys(next).length)
      window.sessionStorage.setItem(storageKey(dateIso), JSON.stringify(next));
    else window.sessionStorage.removeItem(storageKey(dateIso));
  } catch {
    // storage 실패해도 메모리 캐시로 이 세션은 동작(생성 재료 — 영속 실패는 무해)
  }
  for (const cb of listeners) cb();
}
