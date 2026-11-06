import { describe, expect, it } from "vitest";
import { buildNetGraph, netFitView, netLayout, netNeighbors, netRadius, summaryGraph, type NetBoard } from "./graph";
import { placeLabels } from "./labels";
import { planMorphBack, planMorphTo } from "./morph";
import { CENTERS, STUDENT } from "./testing/fixture";

const S = CENTERS["student:s1"];
const C = CENTERS["class:c1"];
const SIZE = { w: 896, h: 780 };
const fitted = (b: NetBoard): NetBoard => ({ ...b, view: netFitView(b, SIZE) });
const screen = (b: { pos: NetBoard["pos"]; view: NetBoard["view"] }, id: string) => ({ x: b.pos[id].x * b.view.k + b.view.x, y: b.pos[id].y * b.view.k + b.view.y });

describe("판 짜기 — 모델 → 점·선", () => {
  it("가운데 1 · 영역 = 조각 수 + 온톨로지 · 출결 '기록' 줄은 하루하루 기록으로 펼친다", () => {
    const g = buildNetGraph(S);
    const count = (k: string) => g.nodes.filter((n) => n.kind === k).length;
    expect(count("root")).toBe(1);
    expect(count("hub")).toBe(STUDENT.sectors.length + 1);
    expect(count("analysis")).toBe(2);
    expect(count("fact")).toBe(4);
    expect(count("target")).toBe(3);
    // 출결: 반별 2 + 하루 기록 19(결석 줄의 기록은 같은 id라 한 번만)
    expect(g.nodes.filter((n) => n.hub === "hub:attendance")).toHaveLength(21);
    expect(g.nodes.find((n) => n.id === "rec:attendance:att0")?.title).toBe("10.06 중2 수학 A반");
    // 점 id는 겹치지 않고 선은 이미 있는 점만 잇는다
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids.size).toBe(g.nodes.length);
    for (const e of g.edges) expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    expect(new Set(g.edges.map((e) => `${e.from}|${e.to}`)).size).toBe(g.edges.length);
  });

  it("같은 대상이 여러 조각에 있으면 점 하나 + 조각마다 선(교사 중심의 담당 수업·담당 원생)", () => {
    const merged = { model: { ...C.model, sectors: [...C.model.sectors, { ...C.model.sectors[0], key: "alumni", label: "지난 원생" }] } };
    const g = buildNetGraph(merged);
    expect(g.nodes.filter((n) => n.id === "student:s1")).toHaveLength(1);
    expect(g.edges.filter((e) => e.to === "student:s1").map((e) => e.from).sort()).toEqual(["hub:alumni", "hub:students"]);
  });

  it("분석 근거 = 줄 id · 조각 key로 잇는다(못 찾으면 잇지 않는다)", () => {
    const g = buildNetGraph({ ...S, analyses: [{ id: "x", title: "분석", detail: "", evidence: ["cs1", "consultations", "없는-id"] }] });
    expect(g.edges.filter((e) => e.from === "an:x").map((e) => e.to).sort()).toEqual(["hub:consultations", "rec:consultations:cs1"].sort());
  });
});

describe("주체별 요약", () => {
  it("가운데 + 영역(기록 수) + 분석만 · 영역 사이 선은 굵기(w)로 합친다", () => {
    const sum = summaryGraph(buildNetGraph(S));
    expect(sum.nodes.every((n) => ["root", "hub", "analysis"].includes(n.kind))).toBe(true);
    expect(sum.nodes.find((n) => n.id === "hub:attendance")?.count).toBe(21);
    expect(sum.nodes.find((n) => n.id === "hub:ontology")?.count).toBe(4);
    const an = sum.edges.find((e) => e.from === "an:flow-consult" || e.to === "an:flow-consult");
    expect(an).toBeTruthy();
    expect(sum.edges.some((e) => (e.w ?? 0) > 1)).toBe(true);
  });
});

describe("배치", () => {
  it("결정적 — 같은 입력이면 같은 자리 · 첫 영역은 맨 위", () => {
    const a = netLayout(S, "records");
    const b = netLayout({ ...S }, "records");
    expect(b.pos).toEqual(a.pos);
    const first = a.pos["hub:subject:math"];
    expect(Math.abs(first.x)).toBeLessThan(1e-6);
    expect(first.y).toBeLessThan(-250);
    expect(netRadius(a.nodes[0], a)).toBe(26);
  });

  it("전체 맞춤 — 모든 점이 판 안", () => {
    const b = fitted(netLayout(S, "records"));
    for (const id in b.pos) {
      const p = screen(b, id);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(SIZE.w);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(SIZE.h);
    }
  });
});

describe("이름 배치 — 겹침 0", () => {
  const overlaps = (b: NetBoard, showAll: boolean, active: string | null) => {
    const placed = placeLabels({
      nodes: b.nodes,
      at: (id) => (b.pos[id] ? screen(b, id) : null),
      radius: (n) => Math.max(2, netRadius(n, b) * Math.sqrt(b.view.k)),
      active,
      neighbors: active ? (b.adjacency.get(active) ?? null) : null,
      hubHover: false,
      showAll,
      k: b.view.k,
      dark: b.mode === "summary",
      centerId: b.centerId,
    });
    let hits = 0;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const p = placed[i].box, q = placed[j].box;
        if (p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y) hits++;
      }
    return { hits, count: placed.length };
  };
  it("이름 표시 전체 · 영역 고름 · 요약 판", () => {
    const rec = fitted(netLayout(S, "records"));
    const all = overlaps(rec, true, null);
    expect(all.hits).toBe(0);
    expect(all.count).toBeGreaterThan(rec.nodes.length * 0.6);
    expect(overlaps(rec, false, "hub:consultations").hits).toBe(0);
    expect(overlaps(fitted(netLayout(S, "summary")), false, null).hits).toBe(0);
  });
});

describe("보간", () => {
  it("들어가기 — u=0이면 지금 화면 그대로(축 점 자리), u=1이면 새 판 전체 맞춤", () => {
    const old = fitted(netLayout(S, "records"));
    const g2 = netLayout(C, "records");
    const plan = planMorphTo(old, g2, "class:c1", "class:c1", SIZE);
    const f0 = plan.frame(0);
    for (const id of ["class:c1", "student:s1", "hub:attendance"]) {
      const a = screen(old, id), b = screen(f0, id);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.01);
    }
    const f1 = plan.frame(1);
    expect(f1.view).toEqual(plan.end.view);
    expect(f1.nodes.filter((n) => (n.op ?? 1) > 0.99).length).toBe(g2.nodes.length);
    // 사라지는 출결 기록은 제 영역 안으로(흡수)
    const sum = netLayout(S, "summary");
    const toSum = planMorphTo(old, sum, old.centerId, sum.centerId, SIZE).frame(1);
    const d = Math.hypot(toSum.pos["rec:attendance:att0"].x - toSum.pos["hub:attendance"].x, toSum.pos["rec:attendance:att0"].y - toSum.pos["hub:attendance"].y);
    expect(d).toBeLessThan(0.01);
  });

  it("되돌아가기 — 끝은 남겨 둔 판 그대로(보기·자리), 지금 중심은 왔던 점 자리로", () => {
    const A = fitted(netLayout(S, "records"));
    A.pos["rec:consultations:cs1"] = { x: A.pos["rec:consultations:cs1"].x + 55, y: A.pos["rec:consultations:cs1"].y - 30 };
    const cur = fitted(netLayout(C, "records"));
    const plan = planMorphBack(cur, A, "class:c1", "class:c1");
    expect(plan.end.view).toEqual(A.view);
    const last = plan.frame(1);
    const p = screen(last, "class:c1"), q = screen(A, "class:c1");
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.01);
    const first = plan.frame(0);
    const c0 = screen(first, "class:c1"), cc = screen(cur, "class:c1");
    expect(Math.hypot(c0.x - cc.x, c0.y - cc.y)).toBeLessThan(0.01);
  });

  it("이웃 — 기록 판 기준(요약이어도)", () => {
    expect(netNeighbors(S, "rec:consultations:cs1").map((n) => n.id)).toContain("an:flow-consult");
  });
});
