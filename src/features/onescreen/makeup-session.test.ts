import { describe, expect, it } from "vitest";
import { addMakeupSessionEntries, hasMakeupSessionEntry, makeupSessionEntries, preserveMakeupSessionEntries } from "./makeup-session";

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

// 원장 2026-10-27 박지호 건 — 자동저장의 `makeup::` 칸은 내용 보관일 뿐, 명단 등록은 등록 문만.
describe("자동저장은 보강 명단을 세우지 않는다(내용 보관 draftOnly)", () => {
  it("명단에 없던 과목의 자동저장 칸은 draftOnly — 명단으로 읽히지 않고 내용은 남는다", () => {
    const next = preserveMakeupSessionEntries({}, { "makeup::math": { makeup: true, today: "p.3", textbook: "가우스" } });
    expect(next["makeup::math"]).toEqual({ makeup: true, today: "p.3", textbook: "가우스", draftOnly: true });
    expect(makeupSessionEntries(next)).toEqual([]);
    expect(hasMakeupSessionEntry(next, "math")).toBe(false);
  });
  it("이미 등록된 과목은 자동저장 뒤에도 등록 그대로(반·결석분 연결 유지, draftOnly 없음)", () => {
    const existing = { "makeup::math": { makeup: true, makeupClassId: "JJ2L", absentDate: "2026-10-21" } };
    const next = preserveMakeupSessionEntries(existing, { "makeup::math": { makeup: true, today: "p.9" } });
    expect(next["makeup::math"]).toEqual({ makeup: true, makeupClassId: "JJ2L", absentDate: "2026-10-21", today: "p.9" });
    expect(makeupSessionEntries(next).map((e) => e.makeupClassId)).toEqual(["JJ2L"]);
  });
  it("draftOnly 칸은 다음 자동저장에도 draftOnly · '보강 빼기' 표시는 그대로 이긴다", () => {
    const draft = { "makeup::math": { makeup: true, draftOnly: true } };
    expect(preserveMakeupSessionEntries(draft, { "makeup::math": { makeup: true, today: "x" } })["makeup::math"]).toEqual({ makeup: true, today: "x", draftOnly: true });
    expect(preserveMakeupSessionEntries({ "makeup::math": { makeup: false } }, { "makeup::math": { makeup: true } })["makeup::math"]).toEqual({ makeup: false });
  });
  it("등록 문은 draftOnly 칸을 새 등록으로 갈아 끼운다 — 옛 보강 줄 글이 되살아나지 않는다", () => {
    const draft = { "makeup::math": { makeup: true, draftOnly: true, draft: "합칠 때 정규 줄로 옮긴 멘트" } };
    const next = addMakeupSessionEntries(draft, [{ subject: "math", makeupClassId: "BS2P" }]);
    expect(next["makeup::math"]).toEqual({ makeupClassId: "BS2P", makeup: true });
    expect(hasMakeupSessionEntry(next, "math")).toBe(true);
  });
  it("옛 칸(draftOnly 없는 makeup:true)은 종전대로 명단이다", () => {
    expect(hasMakeupSessionEntry({ "makeup::math": { makeup: true } }, "math")).toBe(true);
  });
});
