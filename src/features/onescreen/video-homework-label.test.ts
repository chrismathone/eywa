import { expect, it } from "vitest";
import { videoHomeworkDueLabel } from "./video-homework-label";
it("수업일 + 7일 · 월/연도 넘어감 · 빈 날짜", () => {
  expect(videoHomeworkDueLabel("2026-10-02", true)).toBe("10/9 (금)까지");
  expect(videoHomeworkDueLabel("2026-12-29", true)).toBe("1/5 (화)까지");
  expect(videoHomeworkDueLabel("2026-10-02", false)).toBeNull();
  expect(videoHomeworkDueLabel(null, true)).toBeNull();
  expect(videoHomeworkDueLabel("2026-02-31", true)).toBeNull();
});
// 원장 2026-10-15 — 선생님이 고른 마감('다음 수업')을 카드도 같은 문구로 말한다(올리기 사이트·멘트와 같다).
it("저장된 다음 수업 마감 · 저장 전 미리보기 · 쓸 수 없는 마감은 7일", () => {
  expect(videoHomeworkDueLabel("2026-10-12", true, "2026-10-15")).toBe("다음 수업 10/15 (목)까지");
  expect(videoHomeworkDueLabel("2026-10-12", true, null, true)).toBe("다음 수업 전까지");
  expect(videoHomeworkDueLabel("2026-10-12", true, "2026-10-30")).toBe("10/19 (월)까지");
  expect(videoHomeworkDueLabel("2026-10-12", true, "2026-10-15", false)).toBe("10/19 (월)까지");
});
