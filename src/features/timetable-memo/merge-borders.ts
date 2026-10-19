import { cellKey, tidyCell, type BorderLine, type Borders, type Cell, type CellStyle, type Merge, type SheetDoc } from "./doc";

type Side = keyof Borders;
const OPPOSITE = { t: "b", b: "t", l: "r", r: "l" } as const;

/**
 * 병합 칸의 테두리 = **가장자리 칸마다** 적는다(그리는 쪽 grid-base는 칸마다 자기 변 · 병합 속은 덩어리 바깥 변만).
 * 구글 시트는 병합 덩어리의 테두리를 왼쪽 위 칸에만 적어 보낸다. 2026-10-19 실측(침산 판): 병합 399개 중 오른쪽 선 351·
 * 아래 선 37이 왼쪽 위 칸에만 있었고 덮인 칸엔 선이 하나도 없었다 → 434변이 안 그려졌다(원장 *"병합된 열 테두리 덜된거"*).
 */

/** 칸 하나의 한 변을 바꾼다 — `cells`를 직접 고친다(부르는 쪽이 복사본을 넘긴다). */
export function writeSide(cells: SheetDoc["cells"], r: number, c: number, side: Side, line: BorderLine | undefined) {
  const k = cellKey(r, c);
  const prev = cells[k];
  const bd: Borders = { ...prev?.s?.bd };
  if (line) bd[side] = line;
  else delete bd[side];
  const s: CellStyle = { ...prev?.s, bd };
  if (!Object.keys(bd).length) delete s.bd;
  const next = tidyCell({ ...prev, s });
  if (next) cells[k] = next;
  else delete cells[k];
}

const sideAt = (cells: SheetDoc["cells"], r: number, c: number, side: Side) => cells[cellKey(r, c)]?.s?.bd?.[side];
const across = (r: number, c: number, side: Side): [number, number] =>
  side === "t" ? [r - 1, c] : side === "b" ? [r + 1, c] : side === "l" ? [r, c - 1] : [r, c + 1];

/**
 * 아직 나눠 적지 않은 병합(구글 시트에서 온 모양) — 왼쪽 위 칸에 덩어리 **안쪽** 선(아래·오른쪽)이 있거나, 덮인 칸엔 선이
 * 하나도 없는데 왼쪽 위 칸에 퍼뜨릴 위·왼쪽 선이 있다. 한 번 나눠 적으면 둘 다 사라진다 — 그래서 판을 열 때마다 돌려도
 * 사용자가 이웃 칸에서 지우거나 바꾼 선을 되살리지 않는다(리뷰 2026-10-19).
 */
function unlifted(cells: SheetDoc["cells"], m: Merge): boolean {
  const a = cells[cellKey(m.r, m.c)]?.s?.bd;
  if (!a) return false;
  if ((m.rs > 1 && a.b) || (m.cs > 1 && a.r)) return true;
  if (!((m.cs > 1 && a.t) || (m.rs > 1 && a.l))) return false;
  for (let r = m.r; r < m.r + m.rs; r++) {
    for (let c = m.c; c < m.c + m.cs; c++) if ((r !== m.r || c !== m.c) && cells[cellKey(r, c)]?.s?.bd) return false;
  }
  return true;
}

/**
 * 왼쪽 위 칸의 변을 그 변이 놓인 가장자리 칸들로 옮겨 적고, 왼쪽 위 칸에 남은 안쪽 변은 지운다.
 * · 대상 = `force`(방금 만든 병합 — 병합하기)가 있으면 그것, 없으면 아직 나눠 적지 않은 병합만(저장본 펼치기·구글 가져오기·붙여넣기).
 * · 가장자리 칸에 이미 자기 선이 있거나 바깥 이웃이 마주 보는 선을 들고 있으면 채우지 않는다(두 선이 한 자리에 겹치지 않게).
 * · 바뀐 것이 없으면 받은 문서를 그대로 돌려준다.
 */
export function liftMergeBorders(doc: SheetDoc, force?: readonly Merge[]): SheetDoc {
  const targets = force ?? doc.merges.filter((m) => unlifted(doc.cells, m));
  if (!targets.length) return doc;
  const cells = { ...doc.cells };
  let changed = false;
  const fill = (r: number, c: number, side: Side, line: BorderLine) => {
    const [nr, nc] = across(r, c, side);
    if (sideAt(cells, r, c, side) || sideAt(cells, nr, nc, OPPOSITE[side])) return;
    writeSide(cells, r, c, side, line);
    changed = true;
  };
  for (const m of targets) {
    const bd = cells[cellKey(m.r, m.c)]?.s?.bd;
    if (!bd) continue;
    const lastR = m.r + m.rs - 1;
    const lastC = m.c + m.cs - 1;
    for (let c = m.c + 1; c <= lastC; c++) if (bd.t) fill(m.r, c, "t", bd.t);
    for (let r = m.r + 1; r <= lastR; r++) if (bd.l) fill(r, m.c, "l", bd.l);
    for (let c = m.c; c <= lastC; c++) if (bd.b && (lastR !== m.r || c !== m.c)) fill(lastR, c, "b", bd.b);
    for (let r = m.r; r <= lastR; r++) if (bd.r && (lastC !== m.c || r !== m.r)) fill(r, lastC, "r", bd.r);
    if (bd.b && m.rs > 1) {
      writeSide(cells, m.r, m.c, "b", undefined);
      changed = true;
    }
    if (bd.r && m.cs > 1) {
      writeSide(cells, m.r, m.c, "r", undefined);
      changed = true;
    }
  }
  return changed ? { ...doc, cells } : doc;
}

/** 병합 속 칸의 그 변이 덩어리 **안쪽**(그려지지 않는 선)인가 — 테두리 넣기가 안쪽 변을 저장하지 않게. */
export function isInnerMergeSide(m: Merge, r: number, c: number, side: Side): boolean {
  if (side === "t") return r > m.r;
  if (side === "b") return r < m.r + m.rs - 1;
  if (side === "l") return c > m.c;
  return c < m.c + m.cs - 1;
}

/** 판 밖(엑셀·구글 시트)으로 복사할 병합 칸 td의 서식 — 오른쪽·아래 선은 가장자리 칸이 들고 있으니 모아 싣는다. */
export function mergedTdStyle(at: (r: number, c: number) => Cell | undefined, m: Merge): CellStyle | undefined {
  const s = at(m.r, m.c)?.s;
  const r = at(m.r, m.c + m.cs - 1)?.s?.bd?.r;
  const b = at(m.r + m.rs - 1, m.c)?.s?.bd?.b;
  if (!r && !b) return s;
  return { ...s, bd: { ...s?.bd, ...(r ? { r } : {}), ...(b ? { b } : {}) } };
}
