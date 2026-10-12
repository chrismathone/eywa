import { expect, it } from "vitest";
import { isVideoAssignableToDate, videoAssignmentRange } from "./video-assignment";

it.each([
  ["2026-09-30T14:59:59Z", false], // KST 9/30 23:59 = 숙제를 내기 전
  ["2026-09-30T15:00:00Z", true], // KST 10/1 00:00 = 숙제를 낸 당일
  ["2026-10-15T14:59:59Z", true], // KST 10/15 23:59 = 14일 뒤
  ["2026-10-15T15:00:00Z", false], // KST 10/16 00:00 = 15일 뒤
  ["2026-03-15T12:54:02+09:00", false],
  ["invalid", false],
])("10월 1일 숙제 후보는 한국 날짜로 당일부터 14일 뒤까지만: %s", (postedAt, expected) => {
  expect(isVideoAssignableToDate(postedAt, "2026-10-01")).toBe(expected);
});

it("10월 31일 숙제에 10월 24일 영상은 불가하고 11월 14일까지 가능하다", () => {
  expect(isVideoAssignableToDate("2026-10-24T12:00:00+09:00", "2026-10-31")).toBe(false);
  expect(isVideoAssignableToDate("2026-11-14T23:59:59+09:00", "2026-10-31")).toBe(true);
  expect(isVideoAssignableToDate("2026-11-15T00:00:00+09:00", "2026-10-31")).toBe(false);
  expect(videoAssignmentRange(["2026-10-31", "invalid", "2026-10-01"])).toEqual({ from: "2026-10-01", to: "2026-11-14" });
  expect(videoAssignmentRange([])).toBeNull();
});
