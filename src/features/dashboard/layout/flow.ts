/**
 * 이전 배치 변환과 모바일 읽기 배치에 쓰는 흐름 계산. 데스크톱 편집·보기는 fixed-grid.ts의 고정 좌표를 사용한다.
 *
 * 이전 흐름 배치 규칙(2026-10-12부터 데스크톱에서는 자동 확장하지 않는다):
 *  · 놓기 = CSS 격자 자동 배치(sparse)와 같다 — 커서를 앞으로만 옮기며 들어갈 첫 자리에 놓는다. 그래서 읽는 순서 = 목록 순서다.
 *  · 줄 채우기 = 놓은 뒤 줄 끝에 남는 열을 **그 줄 카드들이 나눠 갖는다**(크기 프리셋은 그대로 저장, 넓히는 건 화면에서만).
 *  · 좁은 창(중간)은 카드 폭을 두 배로(1×1 → 반 줄), 폰은 KPI·요약만 반 줄·나머지 한 줄 — **같은 순서**로 다시 흘린다.
 * ⚠️ 2줄짜리 카드 옆에 아무것도 못 들어가는 자리(구멍)는 채우지 못한다 — 편집기가 빗금으로 보여 준다.
 */
import { GRID_COLS, isHeadingId, isKpiId, type Item, type Placed } from "./types";

export type Breakpoint = "desktop" | "medium" | "mobile";

const overlaps = (a: Placed, b: Placed) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** CSS `grid-auto-flow: row`(sparse)와 같은 자리 잡기. 폭이 격자보다 크면 격자 폭으로 줄인다. */
export function pack(items: readonly Pick<Item, "id" | "w" | "h">[], cols = GRID_COLS): Placed[] {
  const placed: Placed[] = [];
  const taken = new Set<string>();
  const free = (x: number, y: number, w: number, h: number) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (taken.has(`${r}:${c}`)) return false;
    return true;
  };
  let row = 0;
  let col = 0;
  for (const it of items) {
    const w = Math.max(1, Math.min(cols, it.w));
    const h = Math.max(1, it.h);
    for (;;) {
      while (col + w <= cols && !free(col, row, w, h)) col++;
      if (col + w <= cols) break;
      row++;
      col = 0;
    }
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) taken.add(`${r}:${c}`);
    placed.push({ id: it.id, x: col, y: row, w, h });
    col += w;
  }
  return placed;
}

/** 한 줄 구간의 카드들이 남는 열을 고르게 나눠 갖게 다시 놓는다 — 아래 줄과 부딪히면 null. */
function spread(all: Placed[], seg: Placed[], start: number, end: number, grow: ReadonlySet<string>): Placed[] | null {
  const free = end - start - seg.reduce((s, i) => s + i.w, 0);
  const growing = seg.filter((i) => grow.has(i.id));
  if (free <= 0 || growing.length === 0) return null;
  const extra = new Map<string, number>();
  growing.forEach((i, idx) => extra.set(i.id, Math.floor(free / growing.length) + (idx < free % growing.length ? 1 : 0)));
  let x = start;
  const moved = seg.map((i) => {
    const next = { ...i, x, w: i.w + (extra.get(i.id) ?? 0) };
    x += next.w;
    return next;
  });
  const ids = new Set(seg.map((i) => i.id));
  const others = all.filter((i) => !ids.has(i.id));
  if (moved.some((m) => others.some((o) => overlaps(m, o)))) return null;
  return [...others, ...moved];
}

/** 줄 채우기(화면 전용) — 줄마다, 위에서 내려온 카드가 막지 않은 구간의 남는 열을 그 구간 카드들이 나눠 갖는다. */
export function fillRows(placed: readonly Placed[], cols = GRID_COLS): Placed[] {
  let out = placed.map((p) => ({ ...p }));
  const maxY = Math.max(0, ...out.map((p) => p.y + p.h));
  for (let y = 0; y < maxY; y++) {
    const blocked = new Array<boolean>(cols).fill(false);
    for (const p of out) if (p.y < y && p.y + p.h > y) for (let c = p.x; c < p.x + p.w; c++) blocked[c] = true;
    for (let c = 0; c < cols; ) {
      if (blocked[c]) {
        c++;
        continue;
      }
      let e = c;
      while (e < cols && !blocked[e]) e++;
      const seg = out.filter((p) => p.y === y && p.x >= c && p.x + p.w <= e).sort((a, b) => a.x - b.x);
      if (seg.length) {
        // 먼저 전부(머리줄 제외) 나눠 갖기 → 2줄 카드가 아래 줄과 부딪히면 1줄 카드만.
        const all = new Set(seg.filter((p) => !isHeadingId(p.id)).map((p) => p.id));
        const single = new Set(seg.filter((p) => !isHeadingId(p.id) && p.h === 1).map((p) => p.id));
        out = spread(out, seg, c, e, all) ?? spread(out, seg, c, e, single) ?? out;
      }
      c = e;
    }
  }
  // 입력 순서 그대로 돌려준다(편집기가 순서로 끼울 자리를 센다).
  const at = new Map(out.map((p) => [p.id, p]));
  return placed.map((p) => at.get(p.id)!);
}

/** 이 화면 폭에서 카드가 차지하는 크기 — 넓은 창은 저장된 크기, 중간은 두 배(1줄), 폰은 KPI·요약 반 줄 · 나머지 한 줄. */
export function sizeAt(item: Pick<Item, "id" | "w" | "h" | "mode">, bp: Breakpoint): { w: number; h: number } {
  if (bp === "desktop") return { w: item.w, h: item.h };
  if (isHeadingId(item.id)) return { w: GRID_COLS, h: 1 };
  if (bp === "medium") return { w: Math.min(GRID_COLS, item.w * 2), h: 1 };
  const small = isKpiId(item.id) || item.mode === "summary";
  return { w: small ? GRID_COLS / 2 : GRID_COLS, h: 1 };
}

/** 순서 + 크기 → 이 화면 폭의 자리(줄 채우기까지). 보기 화면과 편집기가 같은 함수를 쓴다. */
export function layoutAt(items: readonly Pick<Item, "id" | "w" | "h" | "mode">[], bp: Breakpoint): Placed[] {
  return fillRows(pack(items.map((i) => ({ id: i.id, ...sizeAt(i, bp) }))));
}

/** 격자에서 아무 카드도 안 덮은 칸(구멍) — 줄 단위 구간. 마지막 줄 아래는 세지 않는다. */
export function holesOf(placed: readonly Placed[], cols = GRID_COLS): { x: number; y: number; w: number }[] {
  const maxY = Math.max(0, ...placed.map((p) => p.y + p.h));
  const holes: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < maxY; y++) {
    for (let c = 0; c < cols; ) {
      const covered = placed.some((p) => p.y <= y && p.y + p.h > y && p.x <= c && p.x + p.w > c);
      if (covered) {
        c++;
        continue;
      }
      let e = c;
      while (e < cols && !placed.some((p) => p.y <= y && p.y + p.h > y && p.x <= e && p.x + p.w > e)) e++;
      holes.push({ x: c, y, w: e - c });
      c = e;
    }
  }
  return holes;
}

/** 전체 높이(줄 수). */
export const rowsOf = (placed: readonly Placed[]) => Math.max(0, ...placed.map((p) => p.y + p.h));
