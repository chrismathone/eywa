/**
 * 학원 설정 '대시보드 관리'의 칸 목록 편집 — 새 대시보드 배치(`board.ts`)를 칸별로 고친다. **순수 함수**(Vitest).
 * 편집 모양(`EditBoard`)은 저장 모양(`Item[]`)과 1:1로 오간다(`editOf` ↔ `itemsOf`) — 카드마다의 제목·민감 옵션을 잃지 않는다.
 * 카드 하나는 한 자리에만 선다(추이·구성·오늘 운영 구역 중 하나).
 */
import type { PanelId } from "@/features/dashboard/overview/layout";
import { GLANCE_MAX, MIX_HEADING, MIX_TITLE, TREND_HEADING, TREND_TITLE, toBoardItems } from "./board";
import { newItem } from "./engine";
import { BOARD_KPIS, type BoardKpi } from "./registry";
import { CORE_KEYS, isCoreId, isHeadingId, isKpiId, type CoreKey, type Item } from "./types";

export type EditSection = { head: Item; panels: Item[] };
export type EditBoard = { core: CoreKey[]; kpis: Item[]; trend: Item[]; mix: Item[]; today: EditSection[] };
/** 카드가 서는 자리 — 'trend' · 'mix' · 오늘 운영 구역의 머리줄 id. */
export type Spot = "trend" | "mix" | string;

export function editOf(raw: readonly Item[]): EditBoard {
  const items = toBoardItems(raw);
  const e: EditBoard = { core: [], kpis: [], trend: [], mix: [], today: [] };
  let at: Item[] | null = null;
  for (const item of items) {
    if (isCoreId(item.id)) e.core.push(item.id.slice(5) as CoreKey);
    else if (isKpiId(item.id)) e.kpis.push(item);
    else if (item.id === TREND_HEADING) at = e.trend;
    else if (item.id === MIX_HEADING) at = e.mix;
    else if (isHeadingId(item.id)) { const s = { head: item, panels: [] }; e.today.push(s); at = s.panels; }
    else {
      if (!at) { const s = { head: newItem("heading:today", undefined, "오늘 운영"), panels: [] }; e.today.push(s); at = s.panels; }
      at.push(item);
    }
  }
  return e;
}

export function itemsOf(e: EditBoard): Item[] {
  return [
    ...CORE_KEYS.filter((k) => e.core.includes(k)).map((k) => newItem(`core:${k}`)),
    ...e.kpis,
    newItem(TREND_HEADING, undefined, TREND_TITLE), ...e.trend,
    newItem(MIX_HEADING, undefined, MIX_TITLE), ...e.mix,
    // 이름을 비운 구역은 편집 중엔 빈 그대로 두고, 저장·읽기 정리(`sanitizeItems`)가 '이름 없는 구역'으로 채운다.
    ...e.today.flatMap((s) => [s.head, ...s.panels]),
  ];
}

const listOf = (e: EditBoard, spot: Spot): Item[] | null =>
  spot === "trend" ? e.trend : spot === "mix" ? e.mix : (e.today.find((s) => s.head.id === spot)?.panels ?? null);
const clone = (e: EditBoard): EditBoard => ({ core: [...e.core], kpis: [...e.kpis], trend: [...e.trend], mix: [...e.mix], today: e.today.map((s) => ({ head: s.head, panels: [...s.panels] })) });
const withoutPanel = (e: EditBoard, id: string): EditBoard => ({
  ...e, trend: e.trend.filter((i) => i.id !== id), mix: e.mix.filter((i) => i.id !== id), today: e.today.map((s) => ({ ...s, panels: s.panels.filter((i) => i.id !== id) })),
});

export function toggleCore(e: EditBoard, key: CoreKey, on: boolean): EditBoard {
  return { ...e, core: on ? [...new Set([...e.core, key])] : e.core.filter((k) => k !== key) };
}

/** KPI 칸 켜고 끄기 — 둘 다 끄면 배치에서 빠진다. 한눈에 보기는 6칸까지(넘치면 그대로 둔다 — 화면이 안내). */
export function setKpi(e: EditBoard, key: BoardKpi, patch: { glance?: boolean; today?: boolean }): EditBoard {
  const id = `kpi:${key}`;
  const cur = e.kpis.find((i) => i.id === id);
  const glance = patch.glance ?? !!cur?.glance;
  const today = patch.today ?? (cur ? cur.today !== false : false);
  if (glance && !cur?.glance && e.kpis.filter((i) => i.glance).length >= GLANCE_MAX) return e;
  if (!glance && !today) return { ...e, kpis: e.kpis.filter((i) => i.id !== id) };
  const { glance: _g, today: _t, ...rest } = cur ?? newItem(id);
  void _g; void _t;
  const next: Item = { ...rest, ...(glance ? { glance: true } : {}), ...(today ? {} : { today: false }) };
  if (cur) return { ...e, kpis: e.kpis.map((i) => (i.id === id ? next : i)) };
  // 새로 켠 칸은 운영실 순서(BOARD_KPIS)의 제자리에 넣는다.
  const order = (k: string) => BOARD_KPIS.indexOf(k.slice(4) as BoardKpi);
  const at = e.kpis.findIndex((i) => order(i.id) > order(id));
  return { ...e, kpis: at < 0 ? [...e.kpis, next] : [...e.kpis.slice(0, at), next, ...e.kpis.slice(at)] };
}

/** 같은 목록 안에서 한 칸 앞/뒤로(KPI·카드·구역). */
function shift<T>(list: readonly T[], at: number, by: -1 | 1): T[] {
  const to = at + by;
  if (at < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}
export const moveKpi = (e: EditBoard, id: string, by: -1 | 1): EditBoard => ({ ...e, kpis: shift(e.kpis, e.kpis.findIndex((i) => i.id === id), by) });
export function movePanel(e: EditBoard, spot: Spot, id: string, by: -1 | 1): EditBoard {
  const next = clone(e);
  const list = listOf(next, spot);
  if (!list) return e;
  const moved = shift(list, list.findIndex((i) => i.id === id), by);
  list.splice(0, list.length, ...moved);
  return next;
}
export const moveSection = (e: EditBoard, head: string, by: -1 | 1): EditBoard => ({ ...e, today: shift(e.today, e.today.findIndex((s) => s.head.id === head), by) });

/** 카드를 그 자리 맨 뒤에 놓는다(다른 자리에 있었으면 옮긴다 — 옵션·제목은 따라간다). */
export function placePanel(e: EditBoard, panel: PanelId, spot: Spot): EditBoard {
  const id = `panel:${panel}`;
  const old = [...e.trend, ...e.mix, ...e.today.flatMap((s) => s.panels)].find((i) => i.id === id);
  const next = clone(withoutPanel(e, id));
  const list = listOf(next, spot);
  if (!list) return e;
  list.push(old ?? newItem(id));
  return next;
}
export const removePanel = (e: EditBoard, id: string): EditBoard => withoutPanel(e, id);
export function patchPanel(e: EditBoard, id: string, patch: Partial<Pick<Item, "amounts" | "phones" | "title">>): EditBoard {
  const fix = (i: Item): Item => {
    if (i.id !== id) return i;
    const next = { ...i, ...patch };
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined || patch[k] === "") delete next[k];
    return next;
  };
  return { ...e, kpis: e.kpis.map(fix), trend: e.trend.map(fix), mix: e.mix.map(fix), today: e.today.map((s) => ({ ...s, panels: s.panels.map(fix) })) };
}

export function addSection(e: EditBoard, title = "새 구역"): { board: EditBoard; id: string } {
  const id = `heading:${Date.now().toString(36)}`;
  return { board: { ...e, today: [...e.today, { head: newItem(id, undefined, title), panels: [] }] }, id };
}
export function renameSection(e: EditBoard, head: string, patch: { title?: string; note?: string }): EditBoard {
  return { ...e, today: e.today.map((s) => {
    if (s.head.id !== head) return s;
    const next: Item = { ...s.head, ...patch };
    if (!next.note?.trim()) delete next.note;
    return { ...s, head: next };
  }) };
}
/** 구역을 지우면 그 안의 카드도 배치에서 빠진다(다시 넣을 수 있는 '넣지 않은 카드'로). */
export const removeSection = (e: EditBoard, head: string): EditBoard => ({ ...e, today: e.today.filter((s) => s.head.id !== head) });
