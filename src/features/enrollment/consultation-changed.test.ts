import { describe, expect, it } from "vitest";
import { changedColumns, effectiveFollowUp, mergeSubjectDetails, parseEditBase } from "./consultation-changed";

describe("바꾼 칸만 저장 — 수정 화면을 연 때 ↔ 지금", () => {
  it("달라진 칸만 고른다 · 빈 글자와 null은 같다 · 과목 상담은 따로 합친다", () => {
    const base = { counselor: null, career_goal: "", parent_request: "상담", shuttle_bus_request: false, subject_details: {} };
    const mine = { counselor: "", career_goal: "의사", parent_request: "상담", shuttle_bus_request: true, subject_details: { english: { a: "1" } } };
    expect([...changedColumns(mine, base)].sort()).toEqual(["career_goal", "shuttle_bus_request"]);
  });

  it("과목 상담 = DB의 지금 값 위에 이 사람이 바꾼 과목·칸만 얹는다", () => {
    const current = { english: { aiGradeLevel: "초5-6", aiArIndex: "2.1" }, math: { memo: "남이 쓴 메모" } };
    const base = { english: { aiGradeLevel: "" } };
    const mine = { english: { aiGradeLevel: "", aiTopPercent: "52" }, science: { memo: "새 메모" } };
    expect(mergeSubjectDetails(current, base, mine)).toEqual({
      changed: true,
      value: { english: { aiGradeLevel: "초5-6", aiArIndex: "2.1", aiTopPercent: "52" }, math: { memo: "남이 쓴 메모" }, science: { memo: "새 메모" } },
    });
  });

  it("과목 상담을 안 바꿨으면 쓰지 않는다 · 지운 칸은 지운다 · 같은 칸은 내가 이긴다", () => {
    expect(mergeSubjectDetails({ english: { a: "남" } }, {}, {})).toEqual({ changed: false });
    expect(mergeSubjectDetails({ english: { a: "1", b: "2" } }, { english: { a: "1" } }, { english: {} })).toEqual({ changed: true, value: { english: { b: "2" } } });
    expect(mergeSubjectDetails({ english: { a: "남" } }, { english: { a: "" } }, { english: { a: "나" } })).toEqual({ changed: true, value: { english: { a: "나" } } });
    expect(mergeSubjectDetails(null, null, { english: { a: "1" } })).toEqual({ changed: true, value: { english: { a: "1" } } });
  });

  it("모양을 모르는 과목 상담은 종전처럼 이 사람 값을 통째로", () => {
    expect(mergeSubjectDetails({ english: { a: "1" } }, {}, ["이상한 값"])).toEqual({ changed: true, value: ["이상한 값"] });
  });

  it("후속 조치 — 안 바꾼 날짜는 DB의 지금 날짜, 안 바꾼 선택은 그사이 상태가 바뀌었으면 고르지 않은 것으로", () => {
    const common = { baseDate: "2026-10-20", storedDate: "2026-10-30" };
    // 날짜를 안 바꿨다 → 그사이 다른 사람이 옮긴 날짜
    expect(effectiveFollowUp({ ...common, mineDate: "2026-10-20", mineResult: "consulted", baseResult: "consulted", storedStage: "consulted" }))
      .toEqual({ result: "consulted", followUpDate: "2026-10-30" });
    // 날짜를 바꿨다 → 내 날짜
    expect(effectiveFollowUp({ ...common, mineDate: "2026-11-02", mineResult: "consulted", baseResult: "consulted", storedStage: "consulted" }).followUpDate).toBe("2026-11-02");
    // 선택을 안 바꿨는데 그사이 다른 사람이 등록 완료로 → 되돌리지 않는다
    expect(effectiveFollowUp({ ...common, mineDate: "2026-10-20", mineResult: "consulted", baseResult: "consulted", storedStage: "enrolled" }).result).toBeNull();
    // 선택을 바꿨으면 내 선택
    expect(effectiveFollowUp({ ...common, mineDate: "2026-10-20", mineResult: "unregistered", baseResult: "consulted", storedStage: "enrolled" }).result).toBe("unregistered");
    // 처음에 고르지 않은 상태 그대로면 그대로(필수 판정은 resolveFollowUp이 한다)
    expect(effectiveFollowUp({ ...common, mineDate: null, mineResult: null, baseResult: null, storedStage: "consulted" }).result).toBeNull();
  });

  it("editBase는 글자 값만 읽고, 못 읽으면 null(종전처럼 전체 저장)", () => {
    expect(parseEditBase(JSON.stringify({ a: "1", b: 2 }))).toEqual({ a: "1" });
    expect(parseEditBase("깨진 글")).toBeNull();
    expect(parseEditBase(JSON.stringify(["x"]))).toBeNull();
    expect(parseEditBase(null)).toBeNull();
  });
});
