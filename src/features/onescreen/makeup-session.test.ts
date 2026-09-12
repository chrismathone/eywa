import { describe, expect, it } from "vitest";
import { addMakeupSessionEntries, makeupSessionEntries, preserveMakeupSessionEntries } from "./makeup-session";

describe("보고서 저장 전 보강 명단", () => {
  it("미래 결석분 보강도 오늘 세션에서 복원한다", () => {
    const progress = addMakeupSessionEntries({}, [{ subject: "math", absentDate: "2026-09-13", units: 1 }]);
    expect(makeupSessionEntries(JSON.parse(JSON.stringify(progress)))).toEqual([
      { subject: "math", absentDate: "2026-09-13", absentClassId: null, makeupClassId: null, makeupClassName: null, units: 1 },
    ]);
  });
  it("기존에 남아 있던 보강 임시저장도 복원하고 정규+보강 합친 행은 제외한다", () => {
    expect(makeupSessionEntries({ "makeup::math": { makeup: true }, "regular-class": { makeup: true } }).map(e => e.subject)).toEqual(["math"]);
  });
  it("다시 추가해도 작성 중인 멘트와 원래 결석분 연결을 덮지 않는다", () => {
    const prior = { "makeup::math": { makeup: true, draft: "작성 중", absentDate: "2026-09-13" }, regular: { today: "p.3" } };
    expect(addMakeupSessionEntries(prior, [{ subject: "math", absentDate: "2026-09-14" }])).toEqual(prior);
  });
  it("다른 창의 자동저장은 모르는 보강 행을 유지하고 자신이 고친 정규 진도만 반영한다", () => {
    const next = preserveMakeupSessionEntries({ "makeup::math": { makeup: true, units: 1 } }, { regular: { today: "p.9" } });
    expect(next.regular.today).toBe("p.9");
    expect(makeupSessionEntries(next)).toHaveLength(1);
  });
  it("명시적으로 삭제한 보강은 늦은 자동저장으로 되살아나지 않는다", () => {
    const removed = { "makeup::math": { makeup: false } };
    expect(makeupSessionEntries(preserveMakeupSessionEntries(removed, { "makeup::math": { makeup: true } }))).toEqual([]);
    expect(makeupSessionEntries(addMakeupSessionEntries(removed, [{ subject: "math" }]))).toHaveLength(1);
  });
  it("깨진 JSON·비어 있는 과목·일반 저장 값은 보강 명단이 아니다", () => {
    for (const value of [null, [], "math", { "makeup::": { makeup: true } }, { "makeup::math": null }]) {
      expect(makeupSessionEntries(value)).toEqual([]);
    }
  });
});
