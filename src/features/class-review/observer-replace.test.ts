import { describe, expect, it } from "vitest";
import { planObserverReplacement } from "./observer-replace";
import type { ReviewDoc } from "./server/queries";

function docWith(over: Partial<ReviewDoc>): ReviewDoc {
  return {
    id: "d1",
    createdAt: "2026-08-21T00:00:00Z",
    header: {
      date: "2026-08-21",
      teacherId: "T",
      teacherName: "김강사",
      subject: "math",
      className: "",
      session: "",
      classTime: "",
      studentCount: "",
      observerMode: "assigned",
      observerLimit: 3,
    },
    evaluators: [
      { id: "O1", name: "원일", kind: "observer" },
      { id: "O2", name: "설현", kind: "observer" },
      { id: "T", name: "김강사", kind: "self" },
    ],
    submissions: {},
    ...over,
  };
}

describe("평가자 교체 판정", () => {
  it("미채점 평가자는 다른 직원으로 바뀌고 이름·id가 갱신된다", () => {
    const plan = planObserverReplacement(docWith({}), "O1", { id: "N", name: "정유진" });
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    expect(plan.evaluators.find((e) => e.kind === "observer" && e.id === "N")?.name).toBe("정유진");
    expect(plan.evaluators.some((e) => e.id === "O1")).toBe(false);
    // 나머지 평가자·본인 슬롯은 그대로.
    expect(plan.evaluators.some((e) => e.id === "O2")).toBe(true);
    expect(plan.evaluators.find((e) => e.kind === "self")?.id).toBe("T");
  });

  it("이미 채점한 평가자는 거절(점수 유실 방지)", () => {
    const doc = docWith({ submissions: { O1: { scores: [4, 3, 2] } } });
    expect(planObserverReplacement(doc, "O1", { id: "N", name: "정유진" })).toEqual({
      error: "이미 채점을 마친 평가자는 변경할 수 없습니다",
    });
  });

  it("점수가 전부 0(빈 채점)이면 미채점으로 보고 교체 허용", () => {
    const doc = docWith({ submissions: { O1: { scores: [0, 0, 0] } } });
    const plan = planObserverReplacement(doc, "O1", { id: "N", name: "정유진" });
    expect("error" in plan).toBe(false);
    if ("error" in plan) return;
    // 빈 슬롯은 정리된다(옛 id 키 제거).
    expect(plan.submissions.O1).toBeUndefined();
  });

  it("선착순(open) 모드는 교체 대상이 없다", () => {
    const doc = docWith({ header: { ...docWith({}).header, observerMode: "open" } });
    expect(planObserverReplacement(doc, "O1", { id: "N", name: "정유진" })).toEqual({
      error: "선착순 평가는 평가자를 지정하지 않아 변경할 대상이 없습니다",
    });
  });

  it("평가 대상 강사는 평가자가 될 수 없다", () => {
    expect(planObserverReplacement(docWith({}), "O1", { id: "T", name: "김강사" })).toEqual({
      error: "평가 대상 강사는 평가자가 될 수 없습니다",
    });
  });

  it("이미 이 평가의 평가자면 거절(중복)", () => {
    expect(planObserverReplacement(docWith({}), "O1", { id: "O2", name: "설현" })).toEqual({
      error: "이미 이 평가의 평가자입니다",
    });
  });

  it("없는 평가자·같은 사람·빈 값은 거절", () => {
    expect(planObserverReplacement(docWith({}), "ZZZ", { id: "N", name: "X" })).toEqual({
      error: "바꿀 평가자를 찾을 수 없습니다 — 새로고침 후 다시 시도하세요",
    });
    expect(planObserverReplacement(docWith({}), "O1", { id: "O1", name: "원일" })).toEqual({
      error: "같은 사람으로는 바꿀 수 없습니다",
    });
    expect(planObserverReplacement(docWith({}), "", { id: "N", name: "X" })).toEqual({
      error: "평가자 정보를 찾을 수 없습니다",
    });
  });

  it("원본 문서를 변형하지 않는다(참조 공유 오염 방지)", () => {
    const doc = docWith({ submissions: { O1: { scores: [0] } } });
    planObserverReplacement(doc, "O1", { id: "N", name: "정유진" });
    expect(doc.evaluators.some((e) => e.id === "O1")).toBe(true);
    expect(doc.submissions.O1).toBeDefined();
  });
});
