/**
 * 지식그래프 네트워크 보기 설정 — **계정 귀속**(`users.ui_prefs.knowledgeGraph`, CLAUDE.md '모든 뷰 세팅은 계정 귀속'). 연결 탐색
 * (`explore/view-prefs.ts` · `ui_prefs.explore`)과 같은 모양·같은 저장 규칙(기본값은 저장하지 않는다 — 키를 지운다)이되 칸은 따로 둔다
 * (두 화면의 보기를 따로 고른다). 순수 모듈(서버·클라 겸용 · `"use client"`/`server-only` 금지 — #61·#81). 넓게 보기는 저장하지 않는다.
 */
export type KgNetView = "records" | "summary";
export type KgGraphPrefs = {
  /** 개별 기록 | 주체별 요약. */
  netView: KgNetView;
  /** 범례 '영역별 색상'. */
  colored: boolean;
  /** 범례 '이름 표시'. */
  labels: boolean;
};
export const DEFAULT_KG_GRAPH_PREFS: KgGraphPrefs = { netView: "records", colored: false, labels: false };

/** 저장된 원본(무엇이든) → 설정. 모르는 값은 기본값. */
export function parseKgGraphPrefs(raw: unknown): KgGraphPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { netView: o.net_view === "summary" ? "summary" : "records", colored: o.colored === true, labels: o.labels === true };
}

/** 설정 일부 → 저장할 키(기본값이면 undefined = 지운다). */
export function toKgPrefPatch(p: Partial<KgGraphPrefs>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p.netView !== undefined) out.net_view = p.netView === "summary" ? "summary" : undefined;
  if (p.colored !== undefined) out.colored = p.colored ? true : undefined;
  if (p.labels !== undefined) out.labels = p.labels ? true : undefined;
  return out;
}
