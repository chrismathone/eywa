import { describe, expect, it } from "vitest";
import { specialAccessTargets } from "./special-access";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const none = { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] };

describe("개인별 기능 권한 — 이 저장이 새로 지정하는 대상", () => {
  it("저장값을 안 주면 요청 전부가 대상이다", () => {
    const next = { ...none, payslipViewerIds: [A], classSplitterIds: [B], staffSubjectScopes: [{ userId: B, subjects: ["math"] }] };
    const targets = specialAccessTargets(next, null);
    expect(targets.userIds.sort()).toEqual([A, B]);
    expect(targets.subjects).toEqual(["math"]);
  });

  it("이미 지정돼 있던 사람·범위는 뺀다 — 거두는 것은 대상이 아니다", () => {
    const stored = { ...none, payslipViewerIds: [A], staffSubjectScopes: [{ userId: B, subjects: ["math", "english"] }] };
    // 과목 차례만 다른 같은 범위는 그대로 둔 것이다.
    const same = { ...stored, staffSubjectScopes: [{ userId: B, subjects: ["english", "math"] }] };
    expect(specialAccessTargets(same, stored)).toEqual({ userIds: [], subjects: [] });
    expect(specialAccessTargets(none, stored)).toEqual({ userIds: [], subjects: [] });
  });

  it("🔴 칸마다 따로 본다 — 급여명세서에 있던 사람을 수업 나누기에 넣는 것은 새 지정이다", () => {
    const stored = { ...none, payslipViewerIds: [A] };
    expect(specialAccessTargets({ ...stored, classSplitterIds: [A] }, stored).userIds).toEqual([A]);
  });

  it("범위의 과목을 바꾸면 그 줄 전체가 새 지정이다(사람도 과목도 다시 본다)", () => {
    const stored = { ...none, staffSubjectScopes: [{ userId: B, subjects: ["math"] }] };
    expect(specialAccessTargets({ ...none, staffSubjectScopes: [{ userId: B, subjects: ["math", "gone"] }] }, stored)).toEqual({
      userIds: [B],
      subjects: ["math", "gone"],
    });
  });

  it("깨진 저장값에도 던지지 않는다 — 읽을 수 있는 것만 '있던 것'으로 친다", () => {
    const next = { ...none, payslipViewerIds: [A], staffSubjectScopes: [{ userId: B, subjects: ["math"] }] };
    for (const stored of [undefined, "x", [], { payslipViewerIds: "x", staffSubjectScopes: [null, { userId: 3 }, { userId: B }] }]) {
      expect(() => specialAccessTargets(next, stored)).not.toThrow();
      expect(specialAccessTargets(next, stored).userIds.sort()).toEqual([A, B]);
    }
  });
});
