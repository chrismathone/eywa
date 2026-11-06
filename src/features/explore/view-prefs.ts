/**
 * 연결 탐색 보기 설정 — **계정 귀속**(`users.ui_prefs.explore`, CLAUDE.md '모든 뷰 세팅은 계정 귀속'). 순수 모듈(서버·클라 겸용 ·
 * `"use client"`/`server-only` 금지 — #61·#81). 저장은 [`server/prefs-actions.ts`](./server/prefs-actions.ts), 읽기는 page가 `readMyUiPrefs`.
 * 기본값은 저장하지 않는다(키를 지운다).
 */
export type ExploreMode = "donut" | "network";
export type ExploreNetView = "records" | "summary";
export type ExplorePrefs = {
  /** 전환 효과 생략 — 켜면 중심 바꾸기·되돌아가기·보기 전환·확대가 애니메이션 없이 바로(원장 2026-11-05). */
  instant: boolean;
  mode: ExploreMode;
  netView: ExploreNetView;
  /** 네트워크 범례 '영역별 색상'. */
  colored: boolean;
  /** 네트워크 범례 '이름 표시'. */
  labels: boolean;
};
export const DEFAULT_EXPLORE_PREFS: ExplorePrefs = { instant: false, mode: "donut", netView: "records", colored: false, labels: false };

/** 저장된 원본(무엇이든) → 설정. 모르는 값은 기본값. */
export function parseExplorePrefs(raw: unknown): ExplorePrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    instant: o.instant === true,
    mode: o.mode === "network" ? "network" : "donut",
    netView: o.net_view === "summary" ? "summary" : "records",
    colored: o.colored === true,
    labels: o.labels === true,
  };
}

/** 설정 일부 → 저장할 키(기본값이면 undefined = 지운다). */
export function toPrefPatch(p: Partial<ExplorePrefs>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.instant !== undefined) out.instant = p.instant ? true : undefined;
  if (p.mode !== undefined) out.mode = p.mode === "network" ? "network" : undefined;
  if (p.netView !== undefined) out.net_view = p.netView === "summary" ? "summary" : undefined;
  if (p.colored !== undefined) out.colored = p.colored ? true : undefined;
  if (p.labels !== undefined) out.labels = p.labels ? true : undefined;
  return out;
}
