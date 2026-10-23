import { describe, expect, it } from "vitest";
import { sheetDateLabel } from "./pilot-sheet-head";
import { splitSheetSections } from "./pilot-report-sheet";

describe("데일리 학습알림 표(수학 보고서 시범)", () => {
  it("날짜는 요일까지 한 줄 — 서버 시간대와 무관", () => {
    expect(sheetDateLabel("2026-10-23")).toBe("2026.10.23 (금)");
    expect(sheetDateLabel("2026-11-01")).toBe("2026.11.01 (일)");
    expect(sheetDateLabel(null)).toBe("");
  });

  it("테스트·수업 평가는 표 머리로, 나머지는 글 순서 그대로 띠로", () => {
    const levels = "구분　　　　　하　　중하　중　　중상　상\n수업　태도　　○　　○　　○　　○　　●　상";
    const r = splitSheetSections([
      { title: "수업 평가", body: levels },
      { title: "진도", body: "우리 원이는 …" },
      { title: "일일 테스트", body: "20문제 중 17개 맞음" },
      { title: "수업 태도", body: "집중했습니다." },
    ]);
    expect(r.tests.map((s) => s.title)).toEqual(["일일 테스트"]);
    expect(r.levels).toEqual([{ label: "수업 태도", level: "상" }]);
    expect(r.rest.map((s) => s.title)).toEqual(["진도", "수업 태도"]);
  });

  it("수업 평가가 표로 안 읽히면 지어내지 않고 띠로 남긴다", () => {
    const r = splitSheetSections([{ title: "수업 평가", body: "손으로 쓴 글" }]);
    expect(r.levels).toBeNull();
    expect(r.rest.map((s) => s.title)).toEqual(["수업 평가"]);
  });
});
