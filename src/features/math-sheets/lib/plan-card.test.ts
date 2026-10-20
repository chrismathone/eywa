import { describe, expect, it } from "vitest";
import { bookSlices, lessonLabelAt, nextLessonLabel, shortDay } from "./plan-card";

const BOOKS = [
  { title: "가우스 중2-2 3권", lessons: 8 },
  { title: "가우스 중2-2 4권", lessons: 8 },
];

describe("lessonLabelAt", () => {
  it("누적 차시를 권·차시로", () => {
    expect(lessonLabelAt(BOOKS, 7)).toBe("3권 7차시");
    expect(lessonLabelAt(BOOKS, 8)).toBe("3권 8차시");
    expect(lessonLabelAt(BOOKS, 15)).toBe("4권 7차시");
  });
  it("0은 없음, 넘치면 마지막 차시", () => {
    expect(lessonLabelAt(BOOKS, 0)).toBeNull();
    expect(lessonLabelAt(BOOKS, 20)).toBe("4권 8차시");
  });
});

describe("bookSlices", () => {
  it("밀린 차시를 권마다 나눈다 — 실제 7 · 계획 15", () => {
    expect(bookSlices(BOOKS, 7, 15)).toEqual([{ done: 7, late: 1 }, { done: 0, late: 7 }]);
  });
  it("앞서면 밀린 차시 0", () => {
    expect(bookSlices(BOOKS, 10, 4)).toEqual([{ done: 8, late: 0 }, { done: 2, late: 0 }]);
  });
});

it("shortDay", () => {
  expect(shortDay("2026-10-22")).toBe("10.22(목)");
});

describe("nextLessonLabel", () => {
  it("실제 위치의 다음 차시 — 창 앞 권에 있어도 그 권에서", () => {
    expect(nextLessonLabel([BOOKS[1]!], { title: "가우스 중2-2 3권", lessonNo: 7, total: 8 })).toBe("3권 8차시");
  });
  it("권 끝이면 다음 권 1차시, 창 끝이면 없음", () => {
    expect(nextLessonLabel(BOOKS, { title: "가우스 중2-2 3권", lessonNo: 8, total: 8 })).toBe("4권 1차시");
    expect(nextLessonLabel(BOOKS, { title: "가우스 중2-2 4권", lessonNo: 8, total: 8 })).toBeNull();
    expect(nextLessonLabel(BOOKS, null)).toBeNull();
  });
});
