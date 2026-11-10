/**
 * 대시보드 추이 패널의 **막대 / 꺾은선** 선택(원장 2026-09-29 *"막대그래프와 꺾은선그래프 전환이 가능하게 토글 추가"*) —
 * 계정 귀속(`users.ui_prefs.dashboard`, 상시 규칙 "모든 뷰 세팅은 계정 귀속"). 기본값(막대)은 저장하지 않는다.
 * ⚠️ 일반 모듈 — 서버(초기값)와 클라(토글)가 함께 쓴다([[#61]]).
 */
export const CHART_PANELS = ["changes", "billing", "enrolledTrend", "courseTrend"] as const;
export type ChartPanel = (typeof CHART_PANELS)[number];
export type ChartKind = "bar" | "line";
export type ChartKinds = Record<ChartPanel, ChartKind>;

export const DEFAULT_CHART_KINDS: ChartKinds = { changes: "bar", billing: "bar", enrolledTrend: "bar", courseTrend: "bar" };

/** 저장 키 — 패널마다 따로(형제 키 보존은 patchMyUiPrefs가 한다). */
export const chartPrefKey = (panel: ChartPanel) => `chart_${panel}`;

/** 확인할 일 보기 — 항목별(기본 · 저장 안 함) / 사람별. */
export type CheckView = "rows" | "people";
export const parseCheckView = (raw: unknown): CheckView => {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return o.check_view === "people" ? "people" : "rows";
};

export const isChartPanel = (v: unknown): v is ChartPanel => typeof v === "string" && (CHART_PANELS as readonly string[]).includes(v);

/** 저장된 `ui_prefs.dashboard` → 패널별 선택. 모르는 값·깨진 값은 막대. */
export function parseChartKinds(raw: unknown): ChartKinds {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_CHART_KINDS };
  for (const p of CHART_PANELS) if (o[chartPrefKey(p)] === "line") out[p] = "line";
  return out;
}
