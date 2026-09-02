import { describe, expect, it } from "vitest";
import { reportEvidenceKind } from "./derive-from-reports";

/**
 * 보고서 → 파생 근거 분류. 핵심은 **보강 보고서가 정규 반 출석으로 세지 않는 것**이다.
 * 원장 제보 2026-09-02: *"수업을 1회 했는데, 보강1, 본수업1로 되어버렸네"*(이윤 9/2).
 */
const SELF = "class-self";
const SIBLING = "class-sibling";
const same = new Set([SIBLING]);
const kind = (o: Partial<Parameters<typeof reportEvidenceKind>[0]>) =>
  reportEvidenceKind({ makeup: false, classId: null, selectedClassId: SELF, sameSubjectClassIds: same, ...o });

describe("reportEvidenceKind", () => {
  it("보강 보고서는 반이 없든 있든 **언제나 보류**", () => {
    expect(kind({ makeup: true, classId: null })).toBe("hold");
    expect(kind({ makeup: true, classId: SELF })).toBe("hold");
    expect(kind({ makeup: true, classId: SIBLING })).toBe("hold");
    expect(kind({ makeup: true, classId: "class-other" })).toBe("hold");
  });

  it("보강은 **결석 근거도 아니다** — 보류지 무시가 아니다", () => {
    // 무시(ignore)로 보내면 그날이 '보고서 없음 = 결석'으로 뒤집힌다.
    expect(kind({ makeup: true, classId: null })).not.toBe("ignore");
  });

  it("반 미상 + 보강 아님 = 이 반 근거(이관분·관리자 작성)", () => {
    expect(kind({ makeup: false, classId: null })).toBe("own");
    expect(kind({ makeup: null, classId: null })).toBe("own");
    expect(kind({ makeup: undefined, classId: null })).toBe("own");
  });

  it("이 반 보고서 = 근거 · 같은 과목 짝 반 = 보류 · 다른 과목 = 무시", () => {
    expect(kind({ classId: SELF })).toBe("own");
    expect(kind({ classId: SIBLING })).toBe("hold");
    expect(kind({ classId: "class-other" })).toBe("ignore");
  });
});
