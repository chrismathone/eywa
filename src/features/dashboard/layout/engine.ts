/**
 * 배치 목록 다루기 — 넣기·빼기·옮기기(순서)·크기 바꾸기·검증. **순수 함수**(서버·클라 공용, Vitest).
 * 좌표가 있는 배치는 위치·자유 크기를 보존한다. 예전 순서 배치도 읽을 수 있다.
 */
import { KPI_KEYS, type OverviewLayout, type PanelId } from "@/features/dashboard/overview/layout";
import { cardDef, defaultPreset, HEADING_SIZE, isKnownId, nearestPreset, presetOf, type SizePreset } from "./registry";
import { GRID_COLS, MAX_ITEMS, isCoreId, isHeadingId, isStructuralId, type Item } from "./types";
import { gridBounds, isPositioned, placeItem, resizeGridItem } from "./fixed-grid";

const TITLE_MAX = 40;
const NOTE_MAX = 80;

/** 크기를 그 카드의 허용 프리셋으로(모르는 크기는 가장 가까운 것) — 머리줄은 항상 한 줄 전체. */
export function snapItem(item: Item): Item {
  if (isPositioned(item)) return gridBounds(item);
  if (isHeadingId(item.id)) {
    const { mode: _m, amounts: _a, phones: _p, ...rest } = item;
    void _m;
    void _a;
    void _p;
    return { ...rest, ...HEADING_SIZE };
  }
  const def = cardDef(item.id);
  if (!def) return isCoreId(item.id) ? { id: item.id, w: 6, h: 1 } : item;
  const w = Number.isFinite(item.w) ? item.w : def.size.w;
  const h = Number.isFinite(item.h) ? item.h : def.size.h;
  const exact = presetOf(def, { w, h, mode: item.mode });
  const z = exact ?? nearestPreset(def, w, h, item.mode);
  const { mode: _old, ...rest } = item;
  void _old;
  return { ...rest, w: z.w, h: z.h, ...(z.mode ? { mode: z.mode } : {}) };
}

const cleanText = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, max);
  return t ? t : undefined;
};

/**
 * 저장값·외부 입력 → 믿을 수 있는 배치: 모르는 카드 id·중복·제목 없는 머리줄을 버리고 크기를 프리셋으로 맞춘다.
 * 카드에 없는 옵션(수납 카드가 아닌데 `amounts`)은 지운다 — 쓰지 않는 값이 남아 비교·감사로그를 흔들지 않게.
 */
export function sanitizeItems(raw: readonly unknown[]): Item[] {
  const seen = new Set<string>();
  const out: Item[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id || !isKnownId(id) || seen.has(id)) continue;
    // 이름을 비운 구역 머리줄도 구역으로 남긴다(버리면 그 아래 카드가 앞 구역으로 붙는다 — 새 대시보드 칸 목록 2026-11-09).
    const title = cleanText(o.title, TITLE_MAX) ?? (isHeadingId(id) ? "이름 없는 구역" : undefined);
    seen.add(id);
    const def = cardDef(id);
    const item: Item = {
      id,
      w: typeof o.w === "number" ? o.w : NaN,
      h: typeof o.h === "number" ? o.h : NaN,
      ...(typeof o.x === "number" && Number.isFinite(o.x) && typeof o.y === "number" && Number.isFinite(o.y) ? { x: o.x, y: o.y } : {}),
      ...(o.mode === "summary" ? { mode: "summary" as const } : {}),
      ...(title ? { title } : {}),
      ...(cleanText(o.note, NOTE_MAX) ? { note: cleanText(o.note, NOTE_MAX) } : {}),
      ...(def?.options.includes("amounts") && typeof o.amounts === "boolean" ? { amounts: o.amounts } : {}),
      ...(def?.options.includes("phones") && typeof o.phones === "boolean" ? { phones: o.phones } : {}),
      ...(def?.kind === "kpi" && o.glance === true ? { glance: true } : {}),
      ...(def?.kind === "kpi" && o.today === false ? { today: false } : {}),
    };
    out.push(snapItem(item));
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

/** 새 카드(또는 머리줄) 한 칸 — 크기는 그 카드의 기본 크기(또는 고른 프리셋). */
export function newItem(id: string, preset?: SizePreset, title?: string): Item {
  if (isHeadingId(id)) return { id, ...HEADING_SIZE, title: (title ?? "새 구역").slice(0, TITLE_MAX) };
  const def = cardDef(id);
  const z = preset ?? (def ? defaultPreset(def) : { w: 6, h: 1 });
  return { id, w: z.w, h: z.h, ...("mode" in z && z.mode ? { mode: z.mode } : {}) };
}

/** `index` 자리에 넣는다(이미 있으면 그 카드를 옮긴다). 끝 = `items.length`. */
export function insertAt(items: readonly Item[], item: Item, index: number): Item[] {
  if (isPositioned(item)) return placeItem(items, item, item.x, item.y);
  const rest = items.filter((i) => i.id !== item.id);
  if (rest.length >= MAX_ITEMS) return [...items];
  const at = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

export const removeItem = (items: readonly Item[], id: string): Item[] => items.filter((i) => i.id !== id);

/** 카드를 `index`(그 카드를 뺀 목록 기준)로 옮긴다. */
export function moveTo(items: readonly Item[], id: string, index: number): Item[] {
  const item = items.find((i) => i.id === id);
  return item ? insertAt(items, item, index) : [...items];
}

/** 크기 프리셋 바꾸기(요약형 ↔ 일반 포함). */
export function resizeItem(items: readonly Item[], id: string, z: Pick<SizePreset, "w" | "h" | "mode">): Item[] {
  if (items.some(isPositioned)) return resizeGridItem(items, id, { ...z, mode: z.mode });
  return items.map((i) => {
    if (i.id !== id) return i;
    const { mode: _old, ...rest } = i;
    void _old;
    return { ...rest, w: z.w, h: z.h, ...(z.mode ? { mode: z.mode } : {}) };
  });
}

/** 제목·메모·옵션 고치기 — 빈 제목은 기본 이름으로 되돌린다(값을 지운다). */
export function patchItem(items: readonly Item[], id: string, patch: Partial<Pick<Item, "title" | "note" | "amounts" | "phones">>): Item[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const next: Item = { ...i, ...patch };
    for (const key of ["title", "note"] as const) {
      const max = key === "title" ? TITLE_MAX : NOTE_MAX;
      const v = cleanText(next[key], max);
      if (v) next[key] = v;
      else if (!(key === "title" && isHeadingId(i.id))) delete next[key];
    }
    for (const key of ["amounts", "phones"] as const) if (next[key] === undefined) delete next[key];
    return next;
  });
}

/** 놓인 카드 id들(머리줄 제외). */
export const placedIds = (items: readonly Item[]) => items.filter((i) => !isStructuralId(i.id) && !isCoreId(i.id)).map((i) => i.id);

/** 아래에 카드가 하나도 없는 머리줄을 뺀다 — 권한으로 카드가 사라진 구역의 빈 제목줄이 남지 않게. */
export function dropEmptyHeadings(items: readonly Item[]): Item[] {
  return items.filter((it, idx) => {
    if (!isHeadingId(it.id) || isPositioned(it)) return true;
    const next = items[idx + 1];
    return !!next && !isHeadingId(next.id);
  });
}

/** 두 배치가 같은가(순서·크기·제목·옵션까지) — 기본과 같으면 저장값을 만들지 않는다. */
export function sameItems(a: readonly Item[], b: readonly Item[]): boolean {
  const key = (i: Item) => [i.id, i.w, i.h, i.x ?? null, i.y ?? null, i.mode ?? "", i.title ?? "", i.note ?? "", i.amounts ?? null, i.phones ?? null, i.glance ?? false, i.today ?? true];
  return JSON.stringify(a.map(key)) === JSON.stringify(b.map(key));
}

/**
 * 지금 운영실(`OverviewLayout`: KPI 띠 + 구역별 4열 격자) → 순서 있는 배치. 4열 한 칸 = 24열의 6열이라
 * 흘리면(`pack`) 지금 화면의 CSS 격자 자리와 같다(테스트가 잠근다). '학습·학부모 보고 + 학생 상담' 묶음은 반씩 두 장.
 */
export function classicToItems(layout: OverviewLayout): Item[] {
  const kpis = layout.kpis ?? KPI_KEYS;
  // KPI 띠는 한 줄(24열)이다 — ½×1(3열)로 한 줄에 다 안 들어가면(9칸 — 강좌수, 원장 2026-10-20) 앞 칸 3열 · 뒤 칸 2열(⅓×1)로 나눠 꽉 채운다
  // (마지막 한 칸만 다음 줄로 떨어져 그 줄이 비지 않게). 옛 CSS 격자(원장 기본)는 칸 수만큼 같은 폭으로 그린다(`kpiGridVars`).
  const fit = kpis.length * 3 > GRID_COLS && kpis.length * 2 <= GRID_COLS;
  const extra = GRID_COLS - kpis.length * 2;
  const items: Item[] = kpis.map((k, i) => (fit ? { ...newItem(`kpi:${k}`), w: i < extra ? 3 : 2 } : newItem(`kpi:${k}`)));
  for (const section of layout.sections) {
    if (section.title) items.push({ id: `heading:${section.id}`, ...HEADING_SIZE, title: section.title, ...(section.note ? { note: section.note } : {}) });
    for (const slot of section.panels) {
      if (slot === "followup") items.push({ id: "panel:reports", w: 12, h: 1 }, { id: "panel:studentConsult", w: 12, h: 1 });
      else items.push(newItem(`panel:${slot as PanelId}`));
    }
  }
  return items;
}
