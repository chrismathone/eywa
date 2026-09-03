/**
 * 목록 한 쪽의 행 수(쪽 크기) 공용 규약 — 서버(page.tsx)와 클라([AutoPageSize](./auto-page-size.tsx))가 **같은 값**을
 * 읽어야 창 크기를 재어 보낸 `?size=N`이 서버에서 다른 수로 접혀 왕복하지 않는다.
 *
 * 🔴 이 파일은 **지시어 없는 일반 모듈**이어야 한다 — `"use client"` 파일의 함수를 서버 컴포넌트가 부르면 타입체크는
 * 통과하고 요청마다 throw한다([[#81]], 적대적 리뷰 2026-09-03에서 잡힘). 재-export도 그 파일에 두지 말 것.
 */

/** 창이 아무리 작아도 이 아래로는 안 내려간다(쪽 수가 폭발하지 않게). 창 최소 크기(640px)에선 실측 7행. */
export const PAGE_SIZE_MIN = 5;
/** 창이 아무리 커도 이 위로는 안 올라간다(한 요청이 실어 오는 행 수 상한). */
export const PAGE_SIZE_MAX = 120;

/** 서버 쪽 clamp — URL·쿠키가 무엇을 보내든 이 범위 안으로. AutoPageSize도 같은 상수로 접는다. */
export function clampPageSize(raw: string | number | null | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(PAGE_SIZE_MAX, Math.max(PAGE_SIZE_MIN, Math.round(n)));
}

/**
 * 마지막 측정값을 담는 **기기 쿠키** 이름. 이건 보기 설정이 아니라 **창 크기 측정값**이라 계정(`users.ui_prefs`)이 아니라
 * 기기에 둔다 — 같은 계정이라도 PC마다 창 크기가 다르고, 창 크기 자체가 이 PC의 워크스페이스에만 남는다.
 * 서버가 첫 렌더에 이 값을 읽어 그리면 창을 열 때마다 "기본 N행 → 재측정 → 다시 청함"의 두 번째 렌더가 사라진다.
 */
export function pageSizeCookieName(key: string): string {
  return `eywa-ps-${key}`;
}
