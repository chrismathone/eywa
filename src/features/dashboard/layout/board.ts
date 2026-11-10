/**
 * 새 대시보드(한눈에 보기 / 오늘 운영 / 경영 현황)의 배치 — **순수 모듈**(서버·클라 공용 · #61).
 *
 * 저장 모양은 옛 배치와 같은 `Item[]`이다(설정 스키마·서버 조회 게이트 `loadPlan`·값 정리 `shapeSections`를 그대로 쓴다). 순서가 곧 구조다:
 *   `core:*`(핵심 업무 칸) · `kpi:*`(KPI — `glance` = 한눈에 보기 머리 칸 · `today:false` = 오늘 운영 띠에서 뺌)
 *   → `heading:trend` + 추이·비교 카드 → `heading:mix` + 비중·구성 카드 → 그 밖의 `heading:*` = 오늘 운영 구역 + 카드.
 * 크기는 쓰지 않는다(새 대시보드 격자가 정한다) — `w`·`h`는 스키마가 요구해 기본값만 둔다.
 * 옛 배치(두 머리줄이 없는 것)는 읽을 때 한 번 이 모양으로 옮긴다(`toBoardItems` — 원장 2026-11-09 *"새 구조로 자동 옮김"*).
 */
import type { PanelId } from "@/features/dashboard/overview/layout";
import { newItem } from "./engine";
import { BOARD_KPIS, type BoardKpi } from "./registry";
import { CORE_KEYS, isCoreId, isHeadingId, isKpiId, type CoreKey, type Item } from "./types";

export const TREND_HEADING = "heading:trend";
export const MIX_HEADING = "heading:mix";
export const TREND_TITLE = "추이 · 비교";
export const MIX_TITLE = "비중 · 구성";
/** 한눈에 보기 머리 칸의 KPI 수(오늘의 브리핑 옆 3×2). */
export const GLANCE_MAX = 6;

/** 옛 배치를 옮길 때 '추이 · 비교' / '비중 · 구성'으로 보내는 카드(새 대시보드 시안의 나눔 그대로). */
export const TREND_PANELS: readonly PanelId[] = ["changes", "billing6", "enrolledTrend", "courseTrend", "earlyExits"];
export const MIX_PANELS: readonly PanelId[] = ["studentsComp", "attendance", "billingMonth", "newcomerStages"];

export type BoardSection = { id: string; title: string; note: string; panels: PanelId[] };
export type Board = { core: CoreKey[]; kpis: BoardKpi[]; glance: BoardKpi[]; trend: PanelId[]; mix: PanelId[]; today: BoardSection[] };

// 핵심 업무 칸(`core:*`)은 새 편집기에만 있다 — 그것만 남긴 배치도 새 모양이다(옛 배치로 보고 칸 셋을 다시 붙이지 않는다).
export const isBoardItems = (items: readonly Item[]) => items.some((i) => i.id === TREND_HEADING || i.id === MIX_HEADING || isCoreId(i.id));

/** 배치(새 모양) → 화면이 그리는 구조. 머리줄 앞에 떨어진 카드는 '오늘 운영'의 이름 없는 구역으로 둔다. */
export function boardOf(items: readonly Item[]): Board {
  const board: Board = { core: [], kpis: [], glance: [], trend: [], mix: [], today: [] };
  let at: "trend" | "mix" | BoardSection | null = null;
  for (const item of items) {
    if (isCoreId(item.id)) board.core.push(item.id.slice(5) as CoreKey);
    else if (isKpiId(item.id)) {
      const key = item.id.slice(4) as BoardKpi;
      if (item.glance && board.glance.length < GLANCE_MAX) board.glance.push(key);
      if (item.today !== false) board.kpis.push(key);
    } else if (item.id === TREND_HEADING) at = "trend";
    else if (item.id === MIX_HEADING) at = "mix";
    else if (isHeadingId(item.id)) {
      at = { id: item.id.slice(8), title: item.title ?? "", note: item.note ?? "", panels: [] };
      board.today.push(at);
    } else if (item.id.startsWith("panel:")) {
      const panel = item.id.slice(6) as PanelId;
      if (at === "trend" || at === "mix") board[at].push(panel);
      else {
        if (!at) board.today.push((at = { id: "board", title: "", note: "", panels: [] }));
        at.panels.push(panel);
      }
    }
  }
  return board;
}

const heading = (id: string, title: string, note?: string): Item => ({ ...newItem(id, undefined, title), ...(note ? { note } : {}) });
const stripPosition = ({ x: _x, y: _y, ...rest }: Item): Item => (void _x, void _y, rest);

/**
 * 옛 배치 → 새 모양. 카드·제목·민감 옵션(금액·전화번호)은 그대로 옮기고 크기·좌표만 버린다.
 * · KPI: 옛 순서 그대로 오늘 운영 띠에 · 한눈에 보기는 종전 화면 규칙(전일 입테·오늘첫수업 빼고 최근 결석 자리에 오늘 입테 — 전일 입테가 놓였을 때만 · 6칸까지).
 * · 패널: 시안의 추이·구성 카드는 두 머리줄 아래로, 나머지는 옛 구역 그대로 오늘 운영에.
 * · 핵심 업무: 세 칸 모두(열 수 없는 칸은 보는 사람 판정이 뺀다 — `view.ts`).
 * · 원장(`owner`): 등록 후 3개월 내 퇴원을 6개월 청구 뒤에(종전 화면이 값이 오면 세우던 칸).
 */
export function toBoardItems(items: readonly Item[], opts: { owner?: boolean } = {}): Item[] {
  if (isBoardItems(items)) return items.map(stripPosition);
  // 한눈에 보기 = 종전 화면의 규칙 그대로(전일 입테·오늘첫수업은 빼고 최근 결석 자리에 오늘 입테 · 6칸까지) — 옮겨도 보이던 칸이 같다.
  const kpis = items.filter((i) => isKpiId(i.id)).map(stripPosition);
  const calendar = kpis.find((i) => i.id === "kpi:calendar");
  const tests: Item | null = calendar && !kpis.some((i) => i.id === "kpi:todayTests")
    ? { ...newItem("kpi:todayTests"), today: false, ...(calendar.phones !== undefined ? { phones: calendar.phones } : {}) } : null;
  const ordered = kpis.flatMap((i) => (i.id === "kpi:absent" && tests ? [tests, i] : [i]));
  if (tests && !ordered.includes(tests)) ordered.push(tests);
  const glanceIds = ordered.filter((i) => i.id !== "kpi:calendar" && i.id !== "kpi:firstClass" && !(tests && i.id === "kpi:absent"))
    .slice(0, GLANCE_MAX).map((i) => i.id);
  const kpiItems = ordered.map((i) => (glanceIds.includes(i.id) ? { ...i, glance: true } : i));
  const panels = (ids: readonly PanelId[]) => items.filter((i) => ids.includes(i.id.slice(6) as PanelId) && i.id.startsWith("panel:")).map(stripPosition);
  // 원장 화면은 옛 배치에 없어도 '등록 후 3개월 내 퇴원'을 6개월 청구 뒤에 보여 왔다(값이 오면 서는 칸) — 옮길 때 배치 카드로 넣어 그대로 보이게 한다.
  const trend = panels(TREND_PANELS);
  if (opts.owner && !trend.some((i) => i.id === "panel:earlyExits") && !items.some((i) => i.id === "panel:earlyExits")) {
    const at = trend.findIndex((i) => i.id === "panel:billing6");
    trend.splice(at < 0 ? trend.length : at + 1, 0, newItem("panel:earlyExits"));
  }
  const rest: Item[] = [];
  let pendingHead: Item | null = null;
  for (const item of items) {
    if (isHeadingId(item.id)) pendingHead = stripPosition(item);
    else if (item.id.startsWith("panel:") && ![...TREND_PANELS, ...MIX_PANELS].includes(item.id.slice(6) as PanelId)) {
      if (pendingHead) { rest.push(pendingHead); pendingHead = null; }
      else if (!rest.length) rest.push(heading("heading:today", "오늘 운영"));
      rest.push(stripPosition(item));
    }
  }
  return [
    ...CORE_KEYS.map((k) => newItem(`core:${k}`)),
    ...kpiItems,
    heading(TREND_HEADING, TREND_TITLE), ...trend,
    heading(MIX_HEADING, MIX_TITLE), ...panels(MIX_PANELS),
    ...rest,
  ];
}

/** 기본 배치 만들기 — 코드로 적는 역할별 기본(`defaults.ts`). */
export function boardItems(spec: {
  core: readonly CoreKey[]; kpis: readonly BoardKpi[]; glance: readonly BoardKpi[]; trend: readonly PanelId[]; mix: readonly PanelId[];
  today: readonly { id: string; title: string; note?: string; panels: readonly PanelId[] }[];
}): Item[] {
  const kpiIds = [...spec.kpis, ...spec.glance.filter((k) => !spec.kpis.includes(k))];
  return [
    ...spec.core.map((k) => newItem(`core:${k}`)),
    ...BOARD_KPIS.filter((k) => kpiIds.includes(k)).sort((a, b) => kpiIds.indexOf(a) - kpiIds.indexOf(b)).map((k): Item => ({
      ...newItem(`kpi:${k}`), ...(spec.glance.includes(k) ? { glance: true } : {}), ...(spec.kpis.includes(k) ? {} : { today: false }),
    })),
    heading(TREND_HEADING, TREND_TITLE), ...spec.trend.map((p) => newItem(`panel:${p}`)),
    heading(MIX_HEADING, MIX_TITLE), ...spec.mix.map((p) => newItem(`panel:${p}`)),
    ...spec.today.flatMap((s) => [heading(`heading:${s.id}`, s.title, s.note), ...s.panels.map((p) => newItem(`panel:${p}`))]),
  ];
}
