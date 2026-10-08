import { expect, it } from "vitest";
import { videoHomeworkDueLabel } from "./video-homework-label";
it("수업일 + 7일 · 월/연도 넘어감 · 빈 날짜", () => {
  expect(videoHomeworkDueLabel("2026-10-02", true)).toBe("~10/9 (금)");
  expect(videoHomeworkDueLabel("2026-12-29", true)).toBe("~1/5 (화)");
  expect(videoHomeworkDueLabel("2026-10-02", false)).toBeNull();
  expect(videoHomeworkDueLabel(null, true)).toBeNull();
  expect(videoHomeworkDueLabel("2026-02-31", true)).toBeNull();
});
