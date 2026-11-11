import { describe, expect, it } from "vitest";
import { netHeadOf, summaryGraph } from "@/features/explore/components/network/graph";
import { netLayout } from "@/features/explore/components/network/layout";
import { hoverText } from "@/features/explore/components/network/node-actions";
import { entities } from "./catalog";
import type { Edge, Graph, Node } from "./graph";
import { ACADEMY_TITLE, academyNodeId, isolatedCount, kgDetailParam, kgNetBoard, relationLabel } from "./kg-net";
import { visibleGraph } from "@/features/explore/components/network/layout";

/** 지식그래프 → 네트워크 판 — 가상 값(실제 학생·직원 아님). 모양은 운영 그래프(`loadAcademyKnowledge`)와 같다. */
const T = "t";
const id = (k: string) => `${T}:${k}`;
const node = (k: string, type: Node["type"], label: string, extra: Partial<Node> = {}): Node => ({ id: id(k), type, label, source: "시험", ...extra });
const edge = (from: string, to: string, relation: string, sourceRelation = relation): Edge => ({ from: id(from), to: id(to), relation, sourceRelation, basis: "시험", evidence: [], asOf: "2026-11-11" });

const nodes: Node[] = [
  node("academy", "Academy", "학원"),
  node("source:student:academy:t", "Academy", "학원"),
  node("student:s1", "Student", "가나다"),
  node("student:s2", "Student", "라마바"),
  node("student:s3", "Student", "사아자"),
  node("student:s4", "Student", "차카타"),
  node("course:c1", "Course", "중2 수학 A"),
  node("course:c2", "Course", "중3 영어 B"),
  node("staff:k1", "Staff", "선생님 갑"),
  node("school:학교:중2", "School", "학교 중2", { period: "2026-11-11" }),
  node("student_consultation:q1", "Consultation", "상담 1", { attributes: { date: "2026-10-28T23:40:00+00:00", detail: "첫 줄\n둘째 줄" } }),
  node("student_consultation:q2", "Consultation", "상담 2", { attributes: { date: "2026-10-29" } }),
  node("student_consultation:q3", "Consultation", "상담 3", { attributes: { date: "2025-03-01" } }),
  node("attendance_records:r1", "LearningRecord", "출석", { period: "2026-11-01", attributes: { date: null } }),
  node("source:student:evidence:e1", "Evidence", "원기록", { state: "insufficient" }),
  node("knowledge:k1", "Observation", "관찰 기록"),
];
const edges: Edge[] = [
  edge("student:s1", "course:c1", "ENROLLED_IN", "enrolled_in"),
  edge("student:s1", "course:c1", "RELATED_RECORD", "manual-reference:link:x"),
  edge("student:s2", "course:c1", "ENROLLED_IN", "enrolled_in"),
  edge("student:s3", "course:c2", "ENROLLED_IN", "enrolled_in"),
  edge("staff:k1", "course:c1", "TEACHES", "currently_taught_by"),
  edge("student:s1", "school:학교:중2", "STUDIES_AT", "school,grade"),
  edge("student:s2", "school:학교:중2", "STUDIES_AT", "school,grade"),
  edge("student:s1", "student_consultation:q1", "RELATED_RECORD", "consultations"),
  edge("student:s1", "student_consultation:q2", "RELATED_RECORD", "consultations"),
  edge("student:s1", "student_consultation:q3", "RELATED_RECORD", "consultations"),
  edge("student:s1", "attendance_records:r1", "RELATED_RECORD", "attendance"),
  edge("source:student:evidence:e1", "source:student:academy:t", "RELATED_RECORD", "relatedTo"),
  edge("source:student:evidence:e1", "student:s1", "RELATED_RECORD", "evidencedBy"),
  edge("academy", "knowledge:k1", "RELATED_RECORD", "학원에 소속된 기록"),
];
const G: Graph = { version: "v", tenant: T, observedAt: "2026-11-11", nodes, edges, issues: [] };
const SKELETON = (from: string, to: string) => from.startsWith("hub:") || to.startsWith("hub:") || from.startsWith("grp:") || to.startsWith("grp:");

describe("학원 전체 판", () => {
  const b = kgNetBoard(G, null);
  it("가운데 = 학원 전체 · 학원 점(출처마다 실린 것 포함)은 판에 기록으로 서지 않는다 · 나머지는 모두 한 번씩", () => {
    expect(b.center).toEqual({ id: academyNodeId(T), name: ACADEMY_TITLE });
    expect(b.academy).toBe(true);
    const recs = b.graph.nodes.filter((n) => n.kind === "record");
    expect(recs.map((n) => n.id).sort()).toEqual(nodes.filter((n) => n.type !== "Academy").map((n) => n.id).sort());
    expect(b.shown).toBe(14);
    expect(b.total).toBe(14);
    const ids = b.graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of b.graph.edges) expect(ids.includes(e.from) && ids.includes(e.to)).toBe(true);
  });
  it("영역 = 주체 유형(사전 순서 · 한글 이름) · 기록은 제 유형 영역에", () => {
    const order = entities.map((e) => e[0]);
    const hubs = b.graph.nodes.filter((n) => n.kind === "hub");
    expect(hubs.map((h) => h.sectorKey)).toEqual(["Student", "Staff", "Course", "School", "Consultation", "LearningRecord", "Observation", "Evidence"].sort((x, y) => order.indexOf(x as never) - order.indexOf(y as never)));
    expect(hubs.find((h) => h.sectorKey === "Course")?.title).toBe("반·강좌");
    expect(b.graph.nodes.find((n) => n.id === id("student:s1"))?.hub).toBe("hub:Student");
    expect(hubs.find((h) => h.sectorKey === "Student")?.summary).toBe("기록 4건 · 관계 없음 1건");
  });
  it("관계 = 데이터에 있는 것만 · 같은 두 기록은 한 선(이름은 모아서) · 학원 점과의 소속 관계는 긋지 않는다(영역 선이 말한다)", () => {
    const rel = b.graph.edges.filter((e) => !SKELETON(e.from, e.to));
    const s1c1 = rel.find((e) => e.from === id("student:s1") && e.to === id("course:c1"))!;
    expect(s1c1.rel).toBe("수강한다 · 직접 확인한 참고 연결");
    expect(rel.some((e) => e.from === academyNodeId(T) || e.to === academyNodeId(T))).toBe(false);
    const academyIds = new Set(nodes.filter((n) => n.type === "Academy").map((n) => n.id));
    const pairs = new Set(edges.filter((e) => !academyIds.has(e.from) && !academyIds.has(e.to)).map((e) => [e.from, e.to].sort().join("|")));
    for (const e of rel) expect(pairs.has([e.from, e.to].sort().join("|"))).toBe(true);
    expect(rel).toHaveLength(pairs.size);
    expect(pairs.size).toBe(edges.length - 3); // s1–c1 두 관계가 한 선 · 학원 관계 둘 제외
  });
  it("날짜 = attributes.date(시각은 KST) · 없으면 사건 유형의 단일 날짜 period — 연도 → 월 → 같은 날 둘이면 일자 · 학교·평가·근거·비워 둔 날짜 칸은 날짜가 아니다", () => {
    const g = b.graph.nodes;
    expect(g.find((n) => n.id === id("student_consultation:q1"))?.parent).toBe("grp:Consultation:2026-10-29");
    expect(g.find((n) => n.id === "grp:Consultation:2026-10-29")?.tally).toBe(2);
    expect(g.find((n) => n.id === id("student_consultation:q3"))?.parent).toBe("grp:Consultation:2025-03");
    for (const k of ["school:학교:중2", "attendance_records:r1", "student:s1"]) {
      const n = g.find((x) => x.id === id(k))!;
      expect([n.parent, n.date]).toEqual([undefined, null]);
      expect(b.graph.edges.some((e) => e.from === n.hub && e.to === n.id)).toBe(true);
    }
    expect(g.find((n) => n.id === id("student_consultation:q1"))?.detail).toBe("첫 줄");
    expect(g.find((n) => n.id === id("source:student:evidence:e1"))?.detail).toBe("자료 부족");
  });
  it("판 기계(배치·요약·도구줄·hover)가 그대로 돈다 — 도구줄 기록 수 = 판의 기록 전부", () => {
    const L = netLayout(b, "records");
    expect(L.centerId).toBe(academyNodeId(T));
    expect(netHeadOf(L, b.center.name, b.graph).nodes).toBe(b.shown);
    const S = summaryGraph(b.graph);
    expect(S.nodes.find((n) => n.id === "hub:Student")?.count).toBe(4);
    expect(S.edges.find((e) => [e.from, e.to].sort().join("|") === "hub:Course|hub:Student")?.w).toBe(3);
    expect(hoverText(L.nodes.find((n) => n.id === id("course:c1"))!, L)).toContain("더블클릭 = 이것이 중심");
  });
});

describe("기록이 가운데인 판", () => {
  it("학생 = 바로 이어진 기록 + 한 단계 더(학생 아닌 것만) — 강사는 서고 같은 반·같은 학교 학생은 번지지 않는다 · 학원 점은 거치지 않는다", () => {
    const b = kgNetBoard(G, id("student:s1"));
    expect(b.center).toEqual({ id: id("student:s1"), name: "가나다" });
    expect(b.academy).toBe(false);
    const recs = b.graph.nodes.filter((n) => n.kind === "record").map((n) => n.id.slice(2)).sort();
    expect(recs).toEqual(["attendance_records:r1", "course:c1", "school:학교:중2", "source:student:evidence:e1", "staff:k1", "student_consultation:q1", "student_consultation:q2", "student_consultation:q3"].sort());
    expect(b.graph.nodes.filter((n) => n.kind === "root")).toHaveLength(1);
    expect(b.graph.edges.some((e) => e.from === id("student:s1") && e.to === id("course:c1"))).toBe(true);
    expect(b.graph.edges.some((e) => e.to === academyNodeId(T) || e.from === academyNodeId(T))).toBe(false);
    expect([b.shown, b.total]).toEqual([8, 14]);
  });
  it("강사 = 담당 반 + 그 반 학생(같은 유형인 강사는 2단계에서 뺀다) · 학교는 세 단계라 서지 않는다", () => {
    const b = kgNetBoard(G, id("staff:k1"));
    expect(b.graph.nodes.filter((n) => n.kind === "record").map((n) => n.id.slice(2)).sort()).toEqual(["course:c1", "student:s1", "student:s2"]);
  });
  it("없는 점 · 학원 점이 가운데면 학원 전체", () => {
    expect(kgNetBoard(G, id("nope")).academy).toBe(true);
    expect(kgNetBoard(G, id("source:student:academy:t")).center.id).toBe(academyNodeId(T));
  });
});

describe("개별 기록 = 가지를 끝까지(원장 2026-11-11) — 묶음은 모두 펼쳐 있고 더블클릭으로 접는다", () => {
  it("분류 재료가 없으면 기록은 영역 둘레에 바로(옛 '앞 12건 + 나머지' 없음) · 관계 없는 기록 '관계 없음 N건' 묶음도 펼쳐 있다 · 날짜 묶음도 끝까지", () => {
    const many: Node[] = [node("academy", "Academy", "학원"), node("course:c1", "Course", "반"), ...Array.from({ length: 30 }, (_, i) => node(`student:m${i}`, "Student", `학생${i}`)), ...Array.from({ length: 5 }, (_, i) => node(`student:z${i}`, "Student", `혼자${i}`))];
    const rel: Edge[] = Array.from({ length: 30 }, (_, i) => edge(`student:m${i}`, "course:c1", "ENROLLED_IN", "enrolled_in"));
    const b = kgNetBoard({ ...G, nodes: many, edges: rel }, null);
    expect(b.graph.nodes.some((n) => n.id === "grp:Student:more")).toBe(false);
    expect(b.graph.nodes.find((n) => n.id === "grp:Student:none")?.label).toBe("관계 없음 · 5건");
    expect(b.graph.nodes.filter((n) => n.kind === "group").every((n) => n.expanded)).toBe(true);
    expect(visibleGraph(b.graph).nodes.filter((n) => n.kind === "record")).toHaveLength(36);
    expect(visibleGraph(b.graph, new Set(["grp:Student:none"])).nodes.filter((n) => n.kind === "record")).toHaveLength(31); // 더블클릭 = 접기
    const dated = kgNetBoard(G, null);
    expect(visibleGraph(dated.graph).nodes.filter((n) => n.kind === "record")).toHaveLength(dated.shown); // 연도 → 월 → 일자 묶음 아래 기록까지 전부
  });
});

describe("관계선 = 강조할 때만(원장 2026-11-11 '선도 너무 많아서 정신없는데')", () => {
  it("두 기록 사이 실제 관계선은 focusOnly · 뼈대(가운데 → 영역 → 묶음 → 기록)는 늘 그린다 · 이웃 판정엔 그대로 든다", () => {
    const b = kgNetBoard(G, null);
    const tree = (x: string) => x.startsWith("hub:") || x.startsWith("grp:") || x === b.center.id;
    const rel = b.graph.edges.filter((e) => !tree(e.from) && !tree(e.to));
    expect(rel.length).toBeGreaterThan(0);
    expect(rel.every((e) => e.focusOnly)).toBe(true);
    expect(b.graph.edges.filter((e) => tree(e.from) || tree(e.to)).some((e) => e.focusOnly)).toBe(false);
    const L = netLayout(b, "records");
    expect(L.adjacency.get(id("student:s1"))?.has(id("course:c1"))).toBe(true);
  });
  it("기록이 가운데인 판 = 가운데의 직접 관계선은 늘 그린다(가운데는 고른 점이 될 수 없다) · 다른 기록 사이 관계선만 focusOnly", () => {
    const b = kgNetBoard(G, id("student:s1"));
    const center = b.center.id;
    const skeleton = (x: string) => x.startsWith("hub:") || x.startsWith("grp:");
    const direct = b.graph.edges.filter((e) => (e.from === center || e.to === center) && !skeleton(e.from) && !skeleton(e.to));
    expect(direct.length).toBeGreaterThan(0);
    expect(direct.some((e) => e.focusOnly)).toBe(false);
    expect(b.graph.edges.filter((e) => e.focusOnly).every((e) => e.from !== center && e.to !== center)).toBe(true);
  });
});

describe("도우미", () => {
  it("관계 이름 · 연결 없는 기록 수(학원 점 제외) · 상세 자료 주소", () => {
    expect(relationLabel({ relation: "TEACHES", sourceRelation: "currently_taught_by" })).toBe("담당한다");
    expect(relationLabel({ relation: "RELATED_RECORD", sourceRelation: "manual-reference:link:x" })).toBe("직접 확인한 참고 연결");
    expect(relationLabel({ relation: "UNKNOWN", sourceRelation: "raw" })).toBe("raw");
    expect(isolatedCount(G)).toBe(2); // s4 · 학원 소속뿐인 관찰 기록
    const students = [{ id: "s1" }];
    const staff = [{ id: "k1" }];
    expect(kgDetailParam(nodes[2], T, students, staff)).toEqual({ student: "s1" });
    expect(kgDetailParam(nodes[3], T, students, staff)).toBeNull();
    expect(kgDetailParam(nodes[8], T, students, staff)).toEqual({ teacher: "k1" });
    expect(kgDetailParam(nodes[8], T, students, [])).toBeNull();
    expect(kgDetailParam(nodes[6], T, students, staff)).toBeNull();
  });
});

describe("강사 보기 날짜 — 강사 통합 기록·OKR은 날짜를 period에만 싣는다", () => {
  it("사건 유형의 단일 날짜 period만 날짜 · 평가·근거 스냅숏·학교 기준일·비워 둔 날짜 칸·OKR 할 일 마감일은 아니다", () => {
    const mini: Graph = {
      ...G,
      nodes: [
        node("academy", "Academy", "학원"),
        node("class_sheet_student_marks:m1", "LearningRecord", "강사 시트 기록", { period: "2026-11-05" }),
        node("objective:o1", "Objective", "목표", { period: "2026-10-01" }),
        node("rule:a1", "Assessment", "규칙 검토", { period: "2026-11-05" }),
        node("source:teacher:portfolio:p1", "Evidence", "포트폴리오", { period: "2026-11-10T15:10:11.132+00:00" }),
        node("school:학교:중2", "School", "학교 중2", { period: "2026-11-11" }),
        node("attendance_records:r1", "LearningRecord", "출석", { period: "2026-11-01", attributes: { date: null } }),
        node("source:okr:okr_task:t1", "Action", "OKR 할 일", { period: "2026-12-31" }),
      ],
      edges: [],
    };
    const g = kgNetBoard(mini).graph.nodes;
    const dateOfId = (k: string) => g.find((n) => n.id === id(k))?.date ?? null;
    expect(dateOfId("class_sheet_student_marks:m1")).toBe("2026-11-05");
    expect(dateOfId("objective:o1")).toBe("2026-10-01");
    for (const k of ["rule:a1", "source:teacher:portfolio:p1", "school:학교:중2", "attendance_records:r1", "source:okr:okr_task:t1"]) expect(dateOfId(k)).toBeNull();
  });
});
