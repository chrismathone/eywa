import { expect, it } from "vitest";
import { isVideoAssignableToDate } from "./video-assignment";

it.each([
  ["2026-09-01T14:59:59Z", false], // KST 9/1 23:59 = 30일 전
  ["2026-09-01T15:00:00Z", true], // KST 9/2 00:00 = 29일 전
  ["2026-10-30T14:59:59Z", true],
  ["2026-10-30T15:00:00Z", false],
  ["2026-03-15T12:54:02+09:00", false],
  ["invalid", false],
])("10월 1일 숙제 후보는 한국 날짜로 앞뒤 29일까지만: %s", (postedAt, expected) => {
  expect(isVideoAssignableToDate(postedAt, "2026-10-01")).toBe(expected);
});
