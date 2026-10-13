import { describe, expect, it } from "vitest";
import { adminVideoLedgerHref } from "./presentation";

describe("영상 숙제 알림 링크 — 관리자 화면에서는 관리자용 현황으로", () => {
  it("강사 화면 주소를 같은 기간·필터의 관리자 주소로 바꾼다", () => {
    expect(adminVideoLedgerHref("/onescreen/video-homework?from=2026-09-29&to=2026-10-13")).toBe("/lesson-reports/video-homework?from=2026-09-29&to=2026-10-13");
    expect(adminVideoLedgerHref("/onescreen/video-homework")).toBe("/lesson-reports/video-homework");
  });
  it("다른 주소는 그대로 둔다(앞부분만 같은 주소 포함)", () => {
    expect(adminVideoLedgerHref("/onescreen")).toBe("/onescreen");
    expect(adminVideoLedgerHref("/onescreen/video-homework-x")).toBe("/onescreen/video-homework-x");
    expect(adminVideoLedgerHref("/dashboard#repeated-absences")).toBe("/dashboard#repeated-absences");
  });
});
