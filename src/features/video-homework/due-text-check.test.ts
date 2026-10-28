import { describe, expect, it } from "vitest";
import { expectedVideoDue, videoDueDatesInText, videoDueTextMismatch } from "./due-text-check";
import { readVideoDueDefault } from "./due-pref";

describe("videoDueDatesInText — 글에 적힌 영상 숙제 마감", () => {
  it("새 수학 보고서 줄 · 옛 형식 문장 · '다음 수업' 꼴", () => {
    expect(videoDueDatesInText("■ 오늘의 숙제\n시험지 풀어오기.\n영상 숙제가 있습니다(10/30 (금)까지 제출).")).toEqual(["10/30"]);
    expect(videoDueDatesInText("오늘 과제는 p93-99입니다. 영상 과제는 10/26 (월)까지 제출하시면 됩니다.")).toEqual(["10/26"]);
    expect(videoDueDatesInText("영상 제출 마감은 10/30(금)까지입니다.")).toEqual(["10/30"]);
    expect(videoDueDatesInText("영상 숙제가 있습니다(다음 수업 11/3 (화)까지 제출).")).toEqual(["11/3"]);
    expect(videoDueDatesInText("영상 숙제는 11월 3일까지 올려 주세요.")).toEqual(["11/3"]);
  });
  it("영상이 없는 문장 · 지난 영상 숙제 · '까지' 없는 날짜는 보지 않는다", () => {
    expect(videoDueDatesInText("오늘 과제는 10/30까지 풀어 오세요.")).toEqual([]);
    expect(videoDueDatesInText("지난 영상 숙제(10/26까지)도 제출했습니다.")).toEqual([]);
    expect(videoDueDatesInText("10/28 수업에서 영상을 찍었습니다.")).toEqual([]);
    expect(videoDueDatesInText("영상 숙제가 있습니다(다음 수업 전까지 제출).")).toEqual([]);
    expect(videoDueDatesInText(null)).toEqual([]);
  });
});

describe("videoDueTextMismatch — 실측(2026-10-27: 저장 7일 = 11/3, 글 = 10/30)", () => {
  const text = "영상 숙제가 있습니다(10/30 (금)까지 제출).";
  it("7일 마감인데 글이 다음 수업일이면 막는다", () => {
    expect(videoDueTextMismatch(text, expectedVideoDue("2026-10-27", "week", null))).toEqual({ found: "10/30", expected: "11/3" });
  });
  it("다음 수업(10/30)으로 저장되면 통과", () => {
    expect(videoDueTextMismatch(text, expectedVideoDue("2026-10-27", "next", "2026-10-30"))).toBeNull();
  });
  it("다음 수업인데 날짜를 아직 모르면 대조하지 않는다", () => {
    expect(expectedVideoDue("2026-10-27", "next", undefined)).toBeNull();
    expect(videoDueTextMismatch(text, null)).toBeNull();
  });
  it("모드를 안 고른 줄 = 7일 · 날짜가 없는 글은 통과", () => {
    expect(expectedVideoDue("2026-10-27", undefined, null)).toBe("2026-11-03");
    expect(videoDueTextMismatch("영상 숙제가 있습니다.", "2026-11-03")).toBeNull();
  });
});

describe("readVideoDueDefault — 선생님별 기본 마감(계정 ui_prefs)", () => {
  it("'next'만 다음 수업, 그 밖은 7일", () => {
    expect(readVideoDueDefault({ onescreen: { videoDueDefault: "next" } })).toBe("next");
    expect(readVideoDueDefault({ onescreen: { videoDueDefault: "week" } })).toBe("week");
    expect(readVideoDueDefault({ onescreen: { fontSize: "lg" } })).toBe("week");
    expect(readVideoDueDefault(null)).toBe("week");
    expect(readVideoDueDefault({ onescreen: ["next"] })).toBe("week");
  });
});
