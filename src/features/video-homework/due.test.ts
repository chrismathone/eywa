import { describe, expect, it } from "vitest";
import { homeworkDue, homeworkDueText, homeworkOpen, isCustomDue, VIDEO_HOMEWORK_MAX_DUE_DAYS } from "./due";
import { VIDEO_MATCH_WINDOW_DAYS } from "./rounds";
import { SITE_HOMEWORK_DAYS, SITE_LINK_LOOKBACK_DAYS } from "@/features/video-submit/site";

// 원장 2026-10-15 *"다음수업 또는 7일 둘중에 하나 토글하게"* · *"기본값은 7일"*. 10/12 = 월요일.
describe("영상 숙제 마감", () => {
  it("저장값이 없으면 숙제일 + 7일 · 있으면 그 날(그날 포함)", () => {
    expect(SITE_HOMEWORK_DAYS).toBe(7);
    expect(homeworkDue("2026-10-12")).toBe("2026-10-19");
    expect(homeworkDue("2026-10-12", null)).toBe("2026-10-19");
    expect(homeworkDue("2026-10-12", "2026-10-15")).toBe("2026-10-15");
    expect(homeworkOpen("2026-10-12", "2026-10-15", "2026-10-15")).toBe(true);
    expect(homeworkOpen("2026-10-12", "2026-10-16", "2026-10-15")).toBe(false);
    expect(homeworkOpen("2026-10-12", "2026-10-19")).toBe(true);
    expect(homeworkOpen("2026-10-12", "2026-10-20")).toBe(false);
  });
  it("🔴 쓸 수 없는 저장값(숙제일 이전·당일·14일 넘음·모양이 틀림)은 7일로 읽는다 — DB 제약과 같은 범위", () => {
    for (const bad of ["2026-10-12", "2026-10-11", "2026-10-27", "2026-13-01", "다음 수업", ""])
      expect(isCustomDue("2026-10-12", bad), bad).toBe(false);
    expect(isCustomDue("2026-10-12", "2026-10-26")).toBe(true);
    expect(homeworkDue("2026-10-12", "2026-10-27")).toBe("2026-10-19");
  });
  it("🔴 최대 거리 = 장부가 영상을 그 숙제로 세는 창 · 사이트 링크를 거슬러 보는 날수는 링크 수명(최대 거리 + 1) + 하루", () => {
    expect(VIDEO_HOMEWORK_MAX_DUE_DAYS).toBe(VIDEO_MATCH_WINDOW_DAYS);
    expect(SITE_LINK_LOOKBACK_DAYS).toBe(VIDEO_HOMEWORK_MAX_DUE_DAYS + 2);
  });
  it("사람이 읽는 마감 — 7일 · 다음 수업(날짜를 알면 그 날) · 저장 전 '다음 수업 전까지' · 7일로 돌리면 저장값을 보지 않는다", () => {
    expect(homeworkDueText("2026-10-12", null)).toBe("10/19 (월)까지");
    expect(homeworkDueText("2026-10-12", "2026-10-15")).toBe("다음 수업 10/15 (목)까지");
    expect(homeworkDueText("2026-10-12", null, true)).toBe("다음 수업 전까지");
    expect(homeworkDueText("2026-10-12", "2026-10-15", false)).toBe("10/19 (월)까지");
  });
});
