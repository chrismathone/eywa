import { describe, expect, it } from "vitest";
import { netNeighbors } from "@/features/explore/components/network/graph";
import { visibleGraph } from "@/features/explore/components/network/layout";
import type { Edge, Graph, Node } from "./graph";
import { kgNetBoard } from "./kg-net";

/** 분류 묶음(kg-net-groups.ts) — 가상 값(실제 학생·직원 아님). */
const T = "t";
const id = (k: string) => `${T}:${k}`;
const node = (k: string, type: Node["type"], label: string, extra: Partial<Node> = {}): Node => ({ id: id(k), type, label, source: "시험", ...extra });
const edge = (from: string, to: string, relation: string): Edge => ({ from: id(from), to: id(to), relation, sourceRelation: relation, basis: "시험", evidence: [], asOf: "2026-11-11" });
const G: Graph = { version: "v", tenant: T, observedAt: "2026-11-11", nodes: [], edges: [], issues: [] };

describe("분류 묶음 — 학교·원생 = 초·중·고 → 학년 · 직원·반 = 과목 · 기타(원장 2026-11-11 '외~' 대신)", () => {
  const cats = { subjectLabel: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k, subjectOrder: ["math", "english"], gradeOrder: ["7세", "초1", "초4", "중2", "고1"] };
  const grades = ["초4", "초4", "초1", "중2", "고1", "7세", null, "초4", "중2", "고1", "초1", "초4", "중2", "고1"];
  const people: Node[] = grades.map((g, i) => node(`student:p${i}`, "Student", `원생${i}`, { attributes: { grade: g } }));
  const schools: Node[] = ["초4", "중2", "고1", "초1", "초4", "중2", "고1", "초1", "초4", "중2", "고1", "초1", "초4", "중2"].map((g, i) => node(`school:학교${i}:${g}`, "School", `학교${i} ${g}`, { attributes: { school: `학교${i}`, grade: g } }));
  const staff: Node[] = Array.from({ length: 14 }, (_, i) => node(`staff:t${i}`, "Staff", `강사${i}`, { attributes: { subjects: i % 3 === 0 ? [] : i % 3 === 1 ? ["english", "math"] : ["math"] } }));
  const courses: Node[] = Array.from({ length: 14 }, (_, i) => node(`course:k${i}`, "Course", `반${i}`, i % 2 ? { attributes: { subject: "math" } } : {}));
  const rel: Edge[] = [...people.map((p, i) => edge(p.id.slice(2), courses[i].id.slice(2), "ENROLLED_IN")), ...schools.map((x, i) => edge(people[i].id.slice(2), x.id.slice(2), "STUDIES_AT")), ...staff.map((x, i) => edge(x.id.slice(2), courses[i].id.slice(2), "TEACHES"))];
  const graph: Graph = { ...G, nodes: [node("academy", "Academy", "학원"), ...people, ...schools, ...staff, ...courses], edges: rel };

  it("원생 = 초등 → 학년 묶음(설정 학년 순서) · 학년 없는 원생은 '기타 → 학년 모름' · '나머지' 묶음 없음", () => {
    const g = kgNetBoard(graph, null, cats).graph.nodes;
    const kids = (pid: string) => g.filter((n) => n.parent === pid && n.kind === "group").map((n) => n.label);
    expect(kids("hub:Student")).toEqual(["초등 · 6건", "중등 · 3건", "고등 · 3건", "기타 · 2건"]);
    expect(kids("grp:Student:cat:초등")).toEqual(["초1 · 2건", "초4 · 4건"]);
    expect(kids("grp:Student:cat:기타")).toEqual(["7세 · 1건", "학년 모름 · 1건"]);
    expect(g.find((n) => n.id === id("student:p6"))?.parent).toBe("grp:Student:cat:기타/학년 모름");
    expect(g.find((n) => n.id === id("student:p0"))?.parent).toBe("grp:Student:cat:초등/초4");
    expect(g.some((n) => n.id === "grp:Student:more")).toBe(false);
    // 개별 기록 판은 끝까지 펼친다 — 원생 14명 모두 보인다 · 학년 묶음을 접으면 그 원생만 숨는다
    const shown = visibleGraph(kgNetBoard(graph, null, cats).graph);
    expect(shown.nodes.filter((n) => n.kind === "record" && n.hub === "hub:Student")).toHaveLength(14);
    expect(visibleGraph(kgNetBoard(graph, null, cats).graph, new Set(["grp:Student:cat:초등/초4"])).nodes.filter((n) => n.kind === "record" && n.hub === "hub:Student")).toHaveLength(10);
    // 오른쪽 칸 목록의 단위 = 날짜(연도·월)가 아니라 분류 이름
    expect(g.find((n) => n.id === "grp:Student:cat:초등")?.unit).toBe("학교급");
    expect(netNeighbors(kgNetBoard(graph, null, cats), "grp:Student:cat:초등").map((n) => n.unit)).toEqual(["학년", "학년"]);
  });

  it("학교 = 초·중·고 → 학년 → 학교 이름(짧은 이름) · 직원 = 첫 과목 · 과목 없으면 기타 · 반 = 과목 · 기타", () => {
    const g = kgNetBoard(graph, null, cats).graph.nodes;
    const kids = (pid: string) => g.filter((n) => n.parent === pid && n.kind === "group").map((n) => n.label);
    expect(kids("hub:School")).toEqual(["초등 · 7건", "중등 · 4건", "고등 · 3건"]);
    expect(g.find((n) => n.id === id("school:학교0:초4"))?.label).toBe("학교0");
    expect(kids("hub:Staff")).toEqual(["수학 · 4건", "영어 · 5건", "기타 · 5건"]);
    expect(g.find((n) => n.id === "grp:Staff:cat:math")?.expanded).toBe(true);
    expect(kids("hub:Course")).toEqual(["수학 · 7건", "기타 · 7건"]);
  });

  it("관계 없음(직원 = '반·기록 연결 없음') 묶음 안도 같은 분류", () => {
    const few: Graph = { ...G, nodes: [node("academy", "Academy", "학원"), ...staff.slice(0, 4), ...courses.slice(0, 3), node("student:lone1", "Student", "혼자1", { attributes: { grade: "초4" } }), node("student:lone2", "Student", "혼자2", { attributes: { grade: "중2" } })], edges: rel.filter((e) => /staff:t[012]$/.test(e.from)) };
    const b = kgNetBoard(few, null, cats).graph;
    expect(b.nodes.filter((n) => n.parent === "grp:Student:none").map((n) => n.label)).toEqual(["초등 · 1건", "중등 · 1건"]);
    expect(b.nodes.find((n) => n.id === id("student:lone1"))?.parent).toBe("grp:Student:cat:none/초등/초4");
    expect(b.nodes.find((n) => n.id === id("staff:t3"))?.parent).toBe(undefined); // 한 명뿐이면 묶지 않는다
  });

  it("원생 상태 묶음 — 선이 하나도 없는 원생만 지금 상태(휴원·예비·퇴원 · 한글 이름) 묶음 안에서 초·중·고 → 학년 · 연결이 있으면 퇴원이어도 본 분류 · hover 요약도 같은 말", () => {
    const lone = (k: string, grade: string, status: string) => node(`student:${k}`, "Student", k, { attributes: { grade, status } });
    const nodes = [...graph.nodes.map((n) => (n.id === id("student:p0") ? { ...n, attributes: { ...n.attributes, status: "withdrawn" } } : n)), lone("w1", "초4", "withdrawn"), lone("h1", "중2", "on_hold"), lone("e1", "고1", "enrolled"), lone("e2", "고1", "enrolled")];
    const b = kgNetBoard({ ...graph, nodes }, null, cats);
    const g = b.graph.nodes;
    expect(g.filter((n) => n.parent === "hub:Student" && n.kind === "group").map((n) => n.label)).toEqual(["초등 · 6건", "중등 · 3건", "고등 · 3건", "기타 · 2건", "휴원 · 1건", "퇴원 · 1건", "관계 없음 · 2건"]);
    expect(g.find((n) => n.id === id("student:p0"))?.parent).toBe("grp:Student:cat:초등/초4"); // 지난 달 판: 그 달 연결이 있으면 지금 퇴원이어도 본 분류
    expect(g.find((n) => n.id === id("student:w1"))?.parent).toBe("grp:Student:cat:status:withdrawn/초등/초4");
    expect(g.find((n) => n.id === "grp:Student:status:withdrawn")?.title).toBe("학생 · 퇴원 — 지금 상태 · 이 판에 연결 없음");
    expect(g.find((n) => n.id === "hub:Student")?.summary).toBe("기록 18건 · 휴원 1건 · 퇴원 1건 · 관계 없음 2건");
    expect(g.some((n) => /withdrawn|on_hold/.test(n.label ?? ""))).toBe(false);
  });

  it("설정에 없는 과목 키는 '기타'(원문 키를 묶음 이름으로 쓰지 않는다) · 직원은 설정에 있는 첫 과목", () => {
    const odd: Graph = { ...graph, nodes: graph.nodes.map((n) => (n.id === id("staff:t0") ? { ...n, attributes: { subjects: ["subject_9", "math"] } } : n.id === id("course:k1") ? { ...n, attributes: { subject: "subject_9" } } : n)) };
    const g = kgNetBoard(odd, null, cats).graph.nodes;
    expect(g.find((n) => n.id === id("staff:t0"))?.parent).toBe("grp:Staff:cat:math");
    expect(g.find((n) => n.id === id("course:k1"))?.parent).toBe("grp:Course:cat:기타");
    expect(g.some((n) => n.label?.includes("subject_9"))).toBe(false);
  });

  it("학원 설정을 못 받으면 분류 없이 영역 둘레에 바로('나머지' 묶음 없음)", () => {
    const g = kgNetBoard(graph, null).graph.nodes;
    expect(g.some((n) => n.kind === "group" && n.hub === "hub:Student")).toBe(false);
    expect(g.filter((n) => n.kind === "record" && n.hub === "hub:Student").every((n) => !n.parent)).toBe(true);
  });
});
