import { describe, expect, it } from "vitest";
import { netHeadOf, netNeighbors, summaryGraph } from "@/features/explore/components/network/graph";
import { netLayout, visibleGraph } from "@/features/explore/components/network/layout";
import type { Edge, Graph, Node } from "./graph";
import { kgNetBoard } from "./kg-net";

/** '묶기'(kg-net-bundle.ts) — 가상 값(실제 학생·반 아님). */
const T = "t";
const id = (k: string) => `${T}:${k}`;
const node = (k: string, type: Node["type"], label: string, extra: Partial<Node> = {}): Node => ({ id: id(k), type, label, source: "시험", ...extra });
const edge = (from: string, to: string, relation: string): Edge => ({ from: id(from), to: id(to), relation, sourceRelation: relation, basis: "시험", evidence: [], asOf: "2026-11-12" });
const cats = { subjectLabel: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k, subjectOrder: ["math", "english"], gradeOrder: ["초1", "초4", "중2"] };

const grades = ["초4", "초4", "초4", "초1", "중2", "중2"];
const people = grades.map((g, i) => node(`student:p${i}`, "Student", `원생${i}`, { attributes: { grade: g } }));
const courses = [node("course:m1", "Course", "수학A", { attributes: { subject: "math" } }), node("course:m2", "Course", "수학B", { attributes: { subject: "math" } }), node("course:e1", "Course", "영어A", { attributes: { subject: "english" } })];
const talks = [node("consultation:c1", "Consultation", "상담1", { attributes: { date: "2026-11-03" } }), node("consultation:c2", "Consultation", "상담2", { attributes: { date: "2026-10-20" } })];
const graph: Graph = {
  version: "v",
  tenant: T,
  observedAt: "2026-11-12",
  issues: [],
  nodes: [node("academy", "Academy", "학원"), ...people, ...courses, ...talks],
  edges: [
    edge("student:p0", "course:m1", "ENROLLED_IN"),
    edge("student:p1", "course:m1", "ENROLLED_IN"),
    edge("student:p2", "course:m2", "ENROLLED_IN"),
    edge("student:p3", "course:m2", "ENROLLED_IN"),
    edge("student:p4", "course:m1", "ENROLLED_IN"),
    edge("student:p5", "course:e1", "ENROLLED_IN"),
    edge("consultation:c1", "student:p0", "ABOUT"),
    edge("consultation:c2", "student:p1", "ABOUT"),
    edge("student:p0", "student:p1", "SIBLING"),
  ],
};
const G4 = "grp:Student:cat:초등/초4";
const G1 = "grp:Student:cat:초등/초1";
const MATH = "grp:Course:cat:math";
const ties = (edges: { from: string; to: string; w?: number; bundle?: boolean }[]) =>
  Object.fromEntries(edges.filter((e) => e.bundle).map((e) => [[e.from, e.to].sort().join(" ↔ "), e.w]));
const pair = (a: string, b: string) => [a, b].sort().join(" ↔ ");

describe("묶기 — 기록 사이 관계를 묶음(학년 · 과목 · 연도)끼리 한 줄로(원장 2026-11-12)", () => {
  it("끄면 묶은 선이 없다 · 켜면 학년 ↔ 과목 · 연도 ↔ 학년, 굵기 = 기록 짝 수 · 같은 학년끼리(형제)는 잇지 않는다 · 기록 사이 선은 그대로", () => {
    expect(kgNetBoard(graph, null, cats).graph.edges.some((e) => e.bundle)).toBe(false);
    const on = kgNetBoard(graph, null, cats, true).graph;
    const year = on.nodes.find((n) => n.kind === "group" && n.hub === "hub:Consultation" && n.parent === "hub:Consultation")!.id;
    expect(ties(on.edges)).toEqual({
      [pair(G4, MATH)]: 3,
      [pair(G1, MATH)]: 1,
      [pair("grp:Student:cat:중등/중2", MATH)]: 1,
      [pair("grp:Student:cat:중등/중2", "grp:Course:cat:english")]: 1,
      [pair(year, G4)]: 2, // 상담 2건 = 다른 달이어도 한 연도 묶음
    });
    expect(on.edges.filter((e) => e.focusOnly)).toHaveLength(kgNetBoard(graph, null, cats).graph.edges.filter((e) => e.focusOnly).length);
  });

  it("묶음을 접으면 보이는 위 묶음으로 올려 합친다(초등 = 초4 3 + 초1 1) · 입력 선은 고치지 않는다", () => {
    const on = kgNetBoard(graph, null, cats, true).graph;
    const folded = visibleGraph(on, new Set(["grp:Student:cat:초등"]));
    expect(ties(folded.edges)[pair("grp:Student:cat:초등", MATH)]).toBe(4);
    expect(folded.edges.some((e) => e.from === G4 || e.to === G4)).toBe(false);
    expect(ties(on.edges)[pair(G4, MATH)]).toBe(3);
    expect(ties(visibleGraph(on).edges)).toEqual(ties(on.edges)); // 다 펼친 판 = 그대로
  });

  it("같은 관계를 두 번 세지 않는다 — 도구줄 연결선 수 · 요약 판 굵기 · 묶음 안 목록은 켜도 같다", () => {
    const off = kgNetBoard(graph, null, cats);
    const on = kgNetBoard(graph, null, cats, true);
    expect(netHeadOf({ ...on.graph, mode: "records" }, "학원", on.graph).edges).toBe(netHeadOf({ ...off.graph, mode: "records" }, "학원", off.graph).edges);
    expect(summaryGraph(on.graph).edges).toEqual(summaryGraph(off.graph).edges);
    expect(netNeighbors(on, G4)).toEqual(netNeighbors(off, G4));
    // 영역 점 크기(이웃 수)는 켜도 같다 · 묶음은 묶은 선 너머 묶음을 이웃으로 본다(가리키면 그 묶음이 흐려지지 않게)
    const adj = (b: typeof on) => netLayout({ graph: b.graph, center: b.center }, "records").adjacency;
    for (const h of ["hub:Student", "hub:Course", "hub:Consultation"]) expect(adj(on).get(h)?.size).toBe(adj(off).get(h)?.size);
    expect(adj(on).get(G4)?.has(MATH)).toBe(true);
  });
});
