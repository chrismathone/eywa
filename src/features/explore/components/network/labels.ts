import type { NetNode, NetPoint } from "./graph";

/**
 * 네트워크 이름 배치(시안 `netDraw`의 이름 단계 · 원장 11-05 *"최대한 바깥으로 · 안 겹치게"*) — 순수 함수.
 * · 중심·영역·분석·날짜 묶음은 늘, 기록은 고르거나 이웃이거나 '이름 표시'·확대(×2.1 초과) 때. 글 = `label`(묶음 '10월 · 23건' · 기록 '7일 · 제목') 없으면 `title`.
 * · 자리 = 바깥쪽(기록·묶음은 바로 위 점에서, 분석은 중심에서 멀어지는 방향 · 중심·영역은 아래). 겹치면 6px씩 더 바깥으로(최대 48px), 그래도 겹치면
 *   옆·반대편. 멀리 밀린 이름은 점과 가는 선으로 잇는다. 큰 점(중심·영역) 몸통도 장애물. 자리를 못 찾으면 접는다(고른 것만은 늘 보인다).
 * · 영역에 마우스를 올렸을 땐 이웃 기록 이름을 숨긴다(클릭으로 고른 영역은 그대로).
 */

/** 글 폭 어림(px) — 한글 0.8em · 대문자·숫자 0.62 · 나머지 0.54 · 공백 0.3 · 가운뎃점 0.36 · 말줄임 0.9. */
export function labelWidth(t: string, fsz: number, bold: boolean): number {
  let w = 0;
  for (const ch of t) {
    const c = ch.codePointAt(0) ?? 0;
    w +=
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0x3131 && c <= 0x318e) || (c >= 0x4e00 && c <= 0x9fff)
        ? 0.8
        : c === 0x2026
          ? 0.9
          : c === 32
            ? 0.3
            : c === 0xb7 || c === 0x2027
              ? 0.36
              : /[A-Z0-9]/.test(ch)
                ? 0.62
                : 0.54;
  }
  return w * fsz * (bold ? 1.05 : 1) + 6;
}

export type LabelBox = { x: number; y: number; w: number; h: number };
export type PlacedLabel = {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  cls: "root" | "hub" | "";
  bold: boolean;
  /** 불투명도 — 1이면 빈 문자열(속성을 지운다). */
  opacity: string;
  box: LabelBox;
  lead: { x1: number; y1: number; x2: number; y2: number } | null;
};

export type LabelArgs = {
  nodes: NetNode[];
  /** 점의 화면 자리(없으면 null). */
  at: (id: string) => NetPoint | null;
  /** 점의 화면 반지름(px). */
  radius: (n: NetNode) => number;
  active: string | null;
  neighbors: Set<string> | null;
  hubHover: boolean;
  showAll: boolean;
  k: number;
  dark: boolean;
  centerId: string;
  /** 판 크기(px) — 판 밖으로 나가는 자리는 겹친 것으로 친다(가장자리 묶음 이름이 잘리지 않게). */
  bounds?: { w: number; h: number };
};

const hitAny = (b: LabelBox, boxes: LabelBox[], bounds?: { w: number; h: number }) =>
  (!!bounds && (b.x < 2 || b.y < 2 || b.x + b.w > bounds.w - 2 || b.y + b.h > bounds.h - 2)) || boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);

export function placeLabels(a: LabelArgs): PlacedLabel[] {
  const { nodes, at, radius, active, neighbors } = a;
  const boxes: LabelBox[] = [];
  for (const n of nodes)
    if (n.kind === "hub" || n.kind === "root") {
      const p = at(n.id);
      if (!p) continue;
      const r = radius(n) - 2;
      boxes.push({ x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r });
    }
  // 고른 점의 이웃 이름이 날짜 묶음 이름보다 먼저 자리를 잡는다(펼친 하루의 학생 이름이 흐린 묶음 이름에 밀리지 않게).
  const rank = (n: NetNode) => (n.id === active ? 0 : n.kind === "root" ? 1 : n.kind === "hub" ? 2 : n.kind === "analysis" ? 3 : neighbors?.has(n.id) ? 4 : n.kind === "group" ? 5 : 6);
  const ordered = [...nodes].sort((x, y) => rank(x) - rank(y));
  const out: PlacedLabel[] = [];
  for (const n of ordered) {
    const p = at(n.id);
    if (!p) continue;
    const chosen = n.id === active;
    const near = !!neighbors?.has(n.id);
    // 날짜 묶음 이름('10월 · 23건')은 늘 — 기간·건수가 곧 그 묶음의 내용이다(자리가 없으면 접는다).
    const show = n.kind === "root" || n.kind === "hub" || n.kind === "analysis" || n.kind === "group" || chosen || (near && !a.hubHover) || a.showAll || a.k > 2.1;
    if (!show) continue;
    const r = radius(n);
    const base = n.count != null ? `${n.title} ${n.count}` : (n.label ?? n.title);
    const text = base.length > 22 ? `${base.slice(0, 22)}…` : base;
    const fsz = n.kind === "root" ? 17 : n.kind === "hub" ? (a.dark ? 15 : 14) : 12;
    const bold = n.kind === "root" || n.kind === "hub" || n.level === "year" || chosen;
    const bw = labelWidth(text, fsz, bold);
    const bh = fsz + 4;
    const up = n.parent ?? n.hub;
    const from = up && at(up) ? at(up) : n.kind === "analysis" ? at(a.centerId) : null;
    let dir: NetPoint | null = null;
    if (from) {
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const len = Math.hypot(dx, dy);
      if (len > 1) dir = { x: dx / len, y: dy / len };
    }
    const place = (d: NetPoint | null, push: number) => {
      if (!d) {
        const y = p.y + r + push + (n.kind === "root" ? 18 : 13);
        return { x: p.x, y, anchor: "middle" as const, box: { x: p.x - bw / 2, y: y - fsz, w: bw, h: bh } };
      }
      const ax = p.x + d.x * (r + 4 + push);
      const ay = p.y + d.y * (r + 4 + push);
      if (Math.abs(d.x) >= 0.45) {
        const anchor = d.x > 0 ? ("start" as const) : ("end" as const);
        const y = ay + fsz * 0.36;
        return { x: ax, y, anchor, box: { x: anchor === "start" ? ax : ax - bw, y: y - fsz, w: bw, h: bh } };
      }
      const y = d.y > 0 ? ay + fsz : ay - 3;
      return { x: ax, y, anchor: "middle" as const, box: { x: ax - bw / 2, y: y - fsz, w: bw, h: bh } };
    };
    const tries = dir ? [dir, { x: -dir.y, y: dir.x }, { x: dir.y, y: -dir.x }, { x: -dir.x, y: -dir.y }] : [null];
    let got: ReturnType<typeof place> | null = null;
    outer: for (const d of tries)
      for (let push = 0; push <= 48; push += 6) {
        const c = place(d, push);
        // 판 경계는 기록·묶음 이름만 본다 — 가운데·영역 이름은 자리 후보가 아래 하나라 경계에 걸리면 통째로 사라진다(잘려도 보이는 편이 낫다).
        if (!hitAny(c.box, boxes, n.kind === "root" || n.kind === "hub" ? undefined : a.bounds)) {
          got = c;
          break outer;
        }
      }
    if (!got) {
      if (!chosen) continue;
      got = place(dir, 0);
    }
    boxes.push(got.box);
    const o = (active && !chosen && !near ? 0.25 : 1) * (n.op ?? 1);
    let lead: PlacedLabel["lead"] = null;
    if (dir && Math.hypot(got.x - p.x, got.y - p.y) > r + 14) {
      const ex = got.anchor === "start" ? got.x - 2 : got.anchor === "end" ? got.x + 2 : got.x;
      const ey = got.anchor === "middle" ? (got.y > p.y ? got.y - fsz : got.y + 3) : got.y - fsz * 0.36;
      lead = { x1: p.x, y1: p.y, x2: ex, y2: ey };
    }
    out.push({ id: n.id, text, x: got.x, y: got.y, anchor: got.anchor, cls: n.kind === "hub" ? "hub" : n.kind === "root" ? "root" : "", bold: chosen, opacity: o < 1 ? o.toFixed(2) : "", box: got.box, lead });
  }
  return out;
}
