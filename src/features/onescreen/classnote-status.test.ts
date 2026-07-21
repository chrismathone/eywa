import { describe, it, expect } from "vitest";
import { mergeClassnoteStatuses, pendingSendStudentIds } from "./classnote-status";

type Rep = { draft: string; sent: boolean; classnoteStatus?: string };
const rep = (over: Partial<Rep> = {}): Rep => ({ draft: "", sent: true, ...over });

// 이 화면의 (학생, 과목키) → 과목 표시명. 실제 클라는 로스터에서 만든다.
const nameOf = (studentId: string, key: string | null) =>
  studentId === "s1" && key === "math" ? "수학" : undefined;

describe("pendingSendStudentIds", () => {
  it("대기·처리중인 학생만 모은다(끝난 학생은 감시 대상 아님)", () => {
    expect(
      pendingSendStudentIds({
        s1: { 수학: rep({ classnoteStatus: "queued" }) },
        s2: { 영어: rep({ classnoteStatus: "success" }) },
        s3: { 수학: rep({ classnoteStatus: "processing" }) },
      }),
    ).toEqual(["s1", "s3"]);
  });

  it("발송 안 한 화면에선 빈 목록 — 조회를 아예 안 돌린다", () => {
    expect(pendingSendStudentIds({ s1: { 수학: rep() } })).toEqual([]);
  });

  it("실패·동명이인처럼 끝난 상태는 감시하지 않는다(사람이 손대야 풀린다)", () => {
    expect(pendingSendStudentIds({ s1: { 수학: rep({ classnoteStatus: "failed" }) } })).toEqual([]);
  });
});

describe("mergeClassnoteStatuses", () => {
  it("워커가 끝낸 결과를 배지에 반영한다", () => {
    const prev = { s1: { 수학: rep({ classnoteStatus: "queued" }) } };
    const next = mergeClassnoteStatuses(prev, [{ studentId: "s1", subject: "math", status: "success" }], nameOf);
    expect(next.s1!.수학!.classnoteStatus).toBe("success");
    expect(next.s1!.수학!.draft).toBe(""); // 다른 필드는 보존
  });

  it("상태가 비어 있는 행은 무시한다 — 방금 누른 '대기'를 지우면 안 보낸 것처럼 보인다", () => {
    const prev = { s1: { 수학: rep({ classnoteStatus: "queued" }) } };
    const next = mergeClassnoteStatuses(prev, [{ studentId: "s1", subject: "math", status: null }], nameOf);
    expect(next).toBe(prev); // 참조까지 그대로 = 리렌더도 안 남
  });

  it("화면에 없는 과목은 새로 만들지 않는다(다른 강사 담당)", () => {
    const prev = { s1: { 수학: rep({ classnoteStatus: "queued" }) } };
    const next = mergeClassnoteStatuses(prev, [{ studentId: "s1", subject: "english", status: "success" }], nameOf);
    expect(next).toBe(prev);
  });

  it("같은 값이면 참조를 유지한다(불필요한 리렌더 방지)", () => {
    const prev = { s1: { 수학: rep({ classnoteStatus: "success" }) } };
    const next = mergeClassnoteStatuses(prev, [{ studentId: "s1", subject: "math", status: "success" }], nameOf);
    expect(next).toBe(prev);
  });

  it("여러 학생·여러 행을 한 번에 병합한다", () => {
    const prev = {
      s1: { 수학: rep({ classnoteStatus: "queued" }) },
      s9: { 수학: rep({ classnoteStatus: "queued" }) },
    };
    const next = mergeClassnoteStatuses(
      prev,
      [
        { studentId: "s1", subject: "math", status: "processing" },
        { studentId: "s9", subject: "math", status: "success" }, // nameOf가 s1만 알아 무시된다
      ],
      nameOf,
    );
    expect(next.s1!.수학!.classnoteStatus).toBe("processing");
    expect(next.s9!.수학!.classnoteStatus).toBe("queued");
  });
});
