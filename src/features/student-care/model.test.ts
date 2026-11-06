import { describe, expect, it } from "vitest";
import { careContentSchema, careStatus, evidenceHref, transitionCare, type CareContent } from "./model";
import { careGraph } from "./graph";

const manager = { id: "00000000-0000-4000-8000-000000000001", canManage: true, canContribute: true };
const teacher = { id: "00000000-0000-4000-8000-000000000002", canManage: false, canContribute: true };
const at = "2026-11-01T01:00:00.000Z";
const content: CareContent = { need: "중3 선행 희망", promise: "11월 말 중2 진도 완료", criterion: "진도·확인평가 기록 확인", dueOn: "2026-11-30", ownerId: teacher.id, subject: "수학", sourceId: null };
const create = () => transitionCare(null, { kind: "create", content }, manager, at);
const evidence = { kind: "lesson_report" as const, recordId: "00000000-0000-4000-8000-000000000003", note: "마지막 단원 진도와 확인평가 결과" };

describe("상담 약속의 인수·이행", () => {
  it("담당자 본인이 인수하고 증거를 낸 뒤 관리자만 완료한다", () => {
    const first = create();
    expect(() => transitionCare(first, { kind: "acknowledge" }, manager, at)).toThrow("본인");
    expect(() => transitionCare(first, { kind: "complete", reason: "확인" }, manager, at)).toThrow("인수");
    const ack = transitionCare(first, { kind: "acknowledge" }, teacher, at);
    expect(() => transitionCare(ack, { kind: "complete", reason: "확인" }, manager, at)).toThrow("증거");
    const submitted = transitionCare(ack, { kind: "evidence", evidence }, teacher, at);
    expect(submitted.state).toBe("open");
    expect(() => transitionCare(submitted, { kind: "complete", reason: "확인" }, teacher, at)).toThrow("권한");
    expect(transitionCare(submitted, { kind: "complete", reason: "평가 결과 확인" }, manager, at).state).toBe("completed");
  });
  it("변경 시 이전 증거는 보존하되 새 버전의 완료 근거로 인정하지 않는다", () => {
    const submitted = transitionCare(transitionCare(create(), { kind: "acknowledge" }, teacher, at), { kind: "evidence", evidence }, teacher, at);
    const next = transitionCare(submitted, { kind: "revise", content: { ...content, dueOn: "2026-12-31" }, reason: "학부모와 일정 변경 합의" }, manager, at);
    expect(next.revision).toBe(2); expect(next.acknowledged).toBeNull(); expect(next.evidence).toHaveLength(1);
    const ack = transitionCare(next, { kind: "acknowledge" }, teacher, at);
    expect(() => transitionCare(ack, { kind: "complete", reason: "확인" }, manager, at)).toThrow("이번 버전");
  });
  it("미배정자·읽기 전용 담당자의 인수와 증거 제출을 막는다", () => {
    for (const actor of [{ ...teacher, id: manager.id }, { ...teacher, canContribute: false }]) {
      expect(() => transitionCare(create(), { kind: "acknowledge" }, actor, at)).toThrow();
      expect(() => transitionCare(create(), { kind: "evidence", evidence }, actor, at)).toThrow();
    }
  });
  it("중복 증거를 막고 종료된 약속의 일반 수정을 막는다", () => {
    const submitted = transitionCare(create(), { kind: "evidence", evidence }, teacher, at);
    expect(() => transitionCare(submitted, { kind: "evidence", evidence }, teacher, at)).toThrow("이미 연결");
    const cancelled = transitionCare(create(), { kind: "cancel", reason: "진학 계획 변경" }, manager, at);
    expect(() => transitionCare(cancelled, { kind: "acknowledge" }, teacher, at)).toThrow("종료");
  });
  it("90일 경계·기한 당일과 경과를 구분하며 미완료는 계속 남긴다", () => {
    expect(careStatus(create(), "2026-11-30", "2026-09-01")).toMatchObject({ overdue: false, continuing: false });
    expect(careStatus(create(), "2026-12-01", "2026-09-01")).toMatchObject({ overdue: true, continuing: true });
    expect(careStatus(transitionCare(create(), { kind: "cancel", reason: "종료" }, manager, at), "2026-12-01", "2026-09-01").continuing).toBe(false);
  });
  it("실제 날짜를 검증하고 내부 보고서 경로만 사용한다", () => {
    expect(careContentSchema.safeParse({ ...content, dueOn: "2026-02-30" }).success).toBe(false);
    expect(evidenceHref("lesson_report", evidence.recordId)).toBe(`/lesson_reports/${evidence.recordId}/print`);
  });
  it("그래프는 학생·약속·담당자·이번 버전의 증거를 출처와 함께 연결한다", () => {
    const doc = transitionCare(create(), { kind: "evidence", evidence }, teacher, at);
    const graph = careGraph("tenant", [{ id: "promise", studentId: "student", version: 2, document: doc, updatedAt: at }]);
    expect(graph.edges.map((e) => e.kind)).toEqual(["hasCommitment", "assignedTo", "supportedBy"]);
    expect(graph.edges.every((e) => e.basis === "recorded" && e.state === "open")).toBe(true);
    const revised = transitionCare(doc, { kind: "revise", content, reason: "재확인" }, manager, at);
    expect(careGraph("tenant", [{ id: "promise", studentId: "student", version: 3, document: revised, updatedAt: at }]).edges.some((e) => e.kind === "supportedBy")).toBe(false);
  });
  it("등록 전에는 가짜 학생 노드를 만들지 않고 수학 시트는 실제 보고서 노드로 연결한다", () => {
    const doc = transitionCare(create(), { kind: "evidence", evidence: { ...evidence, kind: "math_sheet" } }, teacher, at);
    const graph = careGraph("tenant", [{ id: "promise", studentId: null, version: 2, document: doc, updatedAt: at }]);
    expect(graph.nodes.some((node) => node.kind === "student")).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "lesson_report" && node.sourceId === evidence.recordId)).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "math_sheet")).toBe(false);
  });
});
