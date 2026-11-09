import { describe, expect, it } from "vitest";
import { studentHubGraph, type CareGraph } from "./model";
import type { LiveSection } from "@/features/students/ontology/live-contract";
import type { StudentFact } from "@/features/students/ontology/types";

const input = () => ({ tenant: "a", studentId: "student", name: "동명이인", checkedAt: "2026-11-02", month: "2026-10", sections: [] as LiveSection[], facts: [] as StudentFact[], care: null as CareGraph | null, analyses: [], coverage: [] });
const section = (state: LiveSection["state"] = "ready"): LiveSection => ({ key: "progress", label: "진도", state, total: 1, href: "/students/student", items: [{ id: "report", title: "진도 기록", detail: "내용", evidence: [{ source: "lesson_reports", id: "report", studentId: "student", href: "/lesson_reports/report/print" }] }] });
describe("student hub graph", () => {
  it("같은 이름이어도 학원·학생 ID가 다르면 중심 노드를 합치지 않는다", () => {
    const a = studentHubGraph(input()), b = studentHubGraph({ ...input(), studentId: "other" }), c = studentHubGraph({ ...input(), tenant: "other" });
    expect(new Set([a.root, b.root, c.root]).size).toBe(3);
  });
  it("약속의 수업보고서 증거와 학습 원본을 하나의 노드로 연결한다", () => {
    const data = input(); data.sections = [section()];
    data.care = { schema: "aywa-care-v1", nodes: [{ id: "a:student:student", kind: "student", sourceId: "student" }, { id: "a:commitment:promise", kind: "commitment", sourceId: "promise" }, { id: "a:lesson_report:report", kind: "lesson_report", sourceId: "report" }], edges: [{ from: "a:student:student", to: "a:commitment:promise", kind: "hasCommitment", commitmentId: "promise", revision: 1, state: "open", basis: "recorded" }, { from: "a:commitment:promise", to: "a:lesson_report:report", kind: "supportedBy", commitmentId: "promise", revision: 1, state: "open", basis: "recorded" }] };
    const g = studentHubGraph(data);
    expect(g.nodes.filter(n => n.id === "a:lesson_reports:report")).toHaveLength(1);
    expect(g.edges.some(e => e.from === "a:commitment:promise" && e.to === "a:lesson_reports:report")).toBe(true);
    expect(g.nodes.find(n => n.id === g.root)?.label).toBe("동명이인");
    expect(g.edges.every(e => g.nodes.some(n => n.id === e.from) && g.nodes.some(n => n.id === e.to))).toBe(true);
  });
  it("거절된 자료를 그래프로 되살리지 않고 빈값과 전체 이력을 혼동하지 않는다", () => {
    const g = studentHubGraph({ ...input(), sections: [section("forbidden")] });
    expect(g.nodes).toHaveLength(1);
    expect(g.scope.allHistoryLoaded).toBe(false);
  });
  it("다른 학생·학원 사실을 제외하고 병합 전 근거의 학생 ID는 보존한다", () => {
    const fact: StudentFact = { tenantId: "a", studentId: "student", id: "fact", value: 1, kind: "exam", occurred: { precision: "day", value: "2026-10-01" }, recordedAt: "2026-10-02", related: [], evidence: [{ source: "student_grades", id: "grade", studentId: "old" }], basis: "recorded", access: "student", state: "active" };
    const g = studentHubGraph({ ...input(), facts: [fact, { ...fact, id: "bad", tenantId: "b" }, { ...fact, id: "bad2", studentId: "b" }] });
    expect(g.nodes.find(n => n.id === "a:student_grades:grade")?.attributes?.originalStudentId).toBe("old");
    expect(g.nodes.some(n => n.id.endsWith(":bad") || n.id.endsWith(":bad2"))).toBe(false);
  });
  it("분석을 원본 사실과 분리하고 근거를 연결한다", () => {
    const g = studentHubGraph({ ...input(), sections: [section()], analyses: [{ id: "a1", title: "분석", body: "추론", basis: "ai", generatedAt: null, href: "/students/student", state: "partial", evidence: ["a:lesson_reports:report", "missing"] }] });
    expect(g.edges.find(e => e.relation === "hasAnalysis")).toMatchObject({ basis: "ai", evidence: ["a:lesson_reports:report"] });
  });
  it("동일 수강의 시작·종료 관측을 서로 덮어쓰지 않는다", () => {
    const s = section(); const item = s.items[0];
    s.items = [{ ...item, id: "start", title: "수강 시작", date: "2026-01-01" }, { ...item, id: "end", title: "수강 종료", date: "2026-10-01" }]; s.total = 2;
    const g = studentHubGraph({ ...input(), sections: [s] });
    expect(g.nodes.filter(n => n.kind === "observation").map(n => n.attributes?.date)).toEqual(["2026-01-01", "2026-10-01"]);
    expect(g.nodes.filter(n => n.id === "a:lesson_reports:report")).toHaveLength(1);
  });
});
