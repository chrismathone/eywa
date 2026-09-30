import { describe, expect, it } from "vitest";
import { isCancelledEventTitle } from "./cancelled";

describe("isCancelledEventTitle — 제목의 '취소'", () => {
  it("앞·뒤·괄호·띄어쓰기 모두 취소로 본다", () => {
    for (const title of ["[취소] 레벨테스트 김하늘", "레테 취소", "취소 수학입테 우다인", "영어입테(취 소)"]) {
      expect(isCancelledEventTitle(title), title).toBe(true);
    }
  });
  it("'취소'가 없는 제목은 살아 있는 일정", () => {
    for (const title of ["영수입테 김하늘", "수학 첫 수업", "레벨 테스트", ""]) {
      expect(isCancelledEventTitle(title), title).toBe(false);
    }
  });
});

describe("캘린더 탭 표시 — 무채색·취소선·건수", () => {
  it("취소된 일정의 표시색은 태그·저장 색과 무관하게 무채색", async () => {
    const { eventDisplayColor } = await import("./types");
    const tag = { id: "t", name: "행사", color: "blue" as const };
    expect(eventDisplayColor({ title: "[취소] 설명회", color: "rose", tag })).toBe("neutral");
    expect(eventDisplayColor({ title: "설명회", color: "rose", tag })).toBe("blue");
    expect(eventDisplayColor({ title: "설명회", color: "rose", tag: null })).toBe("rose");
  });
  it("제목 클래스는 취소일 때만 취소선", async () => {
    const { cancelledTitleClass, CANCELLED_TITLE_CLASS } = await import("./cancelled");
    expect(cancelledTitleClass("레테 취소")).toBe(CANCELLED_TITLE_CLASS);
    expect(CANCELLED_TITLE_CLASS).toContain("line-through");
    expect(cancelledTitleClass("레테")).toBe("");
  });
  it("건수 = 살아 있는 것만, 취소는 따로", async () => {
    const { countEvents, cancelledSuffix } = await import("./cancelled");
    const c = countEvents([{ title: "a" }, { title: "[취소] b" }, { title: "c" }]);
    expect(c).toEqual({ active: 2, cancelled: 1 });
    expect(cancelledSuffix(c.cancelled)).toBe(" · 취소 1");
    expect(cancelledSuffix(0)).toBe("");
  });
});
