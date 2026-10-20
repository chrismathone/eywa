import { describe, expect, it } from "vitest";
import { bookRoadmap } from "./book-roadmap";
import { currentWindow, latestOrderedBook } from "./book-window";
import { examPeriodsBetween, middleSchoolDeadline, gradeOrdinal } from "./exam-periods";
import { bookSequence } from "./book-sequence";
import type { CatalogBook } from "./math-book-match";

const book = (id: string, title: string, units: string[]): CatalogBook => ({
  id, title, lessons: units.map((progress, i) => ({ lessonNo: i + 1, progress })),
});
const eight = (name: string) => Array.from({ length: 8 }, (_, i) => `${name} ${i + 1}`);
const B3 = book("b3", "가우스 중2-2 3권", ["5-1. 이등변삼각형의 성질 / 5-2. 직각삼각형의 합동", ...eight("삼").slice(1, 6), "삼각형의 닮음 조건", "닮음 총괄"]);
const B4 = book("b4", "가우스 중2-2 4권", eight("사"));
const CATALOG = [B3, B4];
const SURYEON = { orders: [{ bookName: "가우스 중2-2 3권", date: "2026-07-16" }], catalog: CATALOG, today: "2026-10-20", grade: "중2" };

describe("내신기간", () => {
  it("중2 2학기 중간·기말, 중3은 2학기를 한 덩어리로", () => {
    const p = examPeriodsBetween(gradeOrdinal("중2"), "2026-10-20", "2026-07-01", "2027-12-31").map((x) => `${x.from}~${x.to}`);
    expect(p).toEqual(["2026-05-21~2026-07-10", "2026-08-21~2026-10-10", "2026-11-01~2026-12-10",
      "2027-04-01~2027-05-10", "2027-05-21~2027-07-10", "2027-08-21~2027-11-10"]);
  });
  it("마감 = 중3 11월 말 · 고등은 없음", () => {
    expect(middleSchoolDeadline(gradeOrdinal("중2"), "2026-10-20")).toBe("2027-11-30");
    expect(middleSchoolDeadline(gradeOrdinal("중3"), "2027-01-10")).toBe("2026-11-30");
    expect(middleSchoolDeadline(gradeOrdinal("고1"), "2026-10-20")).toBeNull();
  });
});

describe("교재 순서", () => {
  it("중2-2 4권 다음은 중3-1 1권(교재목록에 없어도 8차시로 가정)", () => {
    const s = bookSequence("가우스|중2-2|4", CATALOG, 4);
    expect(s.map((b) => b.title)).toEqual(["가우스 중2-2 4권", "가우스 중3-1 1권", "가우스 중3-1 2권", "가우스 중3-2 3권"]);
    expect(s[1]).toMatchObject({ catalog: null, lessonCount: 8 });
  });
  it("중3-2 다음은 고1-1", () => {
    expect(bookSequence("가우스|중3-2|4", CATALOG, 2)[1]!.term).toBe("고1-1");
  });
});

describe("전체 목표(로드맵)", () => {
  it("김수련 — 내신 빼고 3개월에 2권 · 중3 11월 말까지 중3-2 3권", () => {
    const r = bookRoadmap({ ...SURYEON, reports: [{ date: "2026-10-13", textbook: "가우스 중2-2 3권", progress: "수학 삼각형의 닮음 조건" }], referenceDate: "2026-10-20" })!;
    expect(r.startDate).toBe("2026-07-23");
    expect(r.books.map((b) => `${b.title}:${b.finishDate}`)).toEqual([
      "가우스 중2-2 3권:2026-10-27", "가우스 중2-2 4권:2027-01-21",
      "가우스 중3-1 1권:2027-03-07", "가우스 중3-1 2권:2027-07-21", "가우스 중3-2 3권:2027-11-26",
    ]);
    expect(r.target).toMatchObject({ key: "가우스|중3-2|3", auto: true });
    expect(r).toMatchObject({ total: 40, planned: 7, done: 7, status: "on" });
  });
  it("내신기간엔 계획이 늘지 않는다", () => {
    const at = (d: string) => bookRoadmap({ ...SURYEON, reports: [], referenceDate: d })!.planned;
    expect(at("2026-08-25")).toBe(at("2026-10-05"));
    expect(bookRoadmap({ ...SURYEON, reports: [], referenceDate: "2026-09-10" })!.examNow?.label).toBe("중2 2학기 중간");
  });
  it("목표 권을 고르면 속도는 그대로, 끝나는 날만 바뀐다", () => {
    const r = bookRoadmap({ ...SURYEON, reports: [], referenceDate: "2026-10-20", targetKey: "가우스|중3-1|2" })!;
    expect(r.target).toMatchObject({ key: "가우스|중3-1|2", auto: false, autoKey: "가우스|중3-2|3" });
    expect(r).toMatchObject({ total: 32, endDate: "2027-07-21", planned: 7 });
  });
});

describe("지금 창", () => {
  it("4권 주문 → 4권 + 중3-1 1권이 한 창", () => {
    const r = bookRoadmap({ orders: [{ bookName: "가우스 중2-2 4권", date: "2026-10-01" }], catalog: CATALOG, today: "2026-10-20", grade: "중2", reports: [], referenceDate: "2026-10-20" })!;
    const w = currentWindow(r);
    expect(w.books.map((b) => [b.title, b.listed])).toEqual([["가우스 중2-2 4권", true], ["가우스 중3-1 1권", false]]);
    expect(w).toMatchObject({ startDate: "2026-10-08", total: 16, orderDate: "2026-10-01" });
    expect(w.examDays).toBe(43); // 10/8~10/10(2학기 중간 끝) + 11/1~12/10
  });
  it("두 권을 3개월 안에 나눠 샀으면 먼저 산 날이 시작", () => {
    const r = bookRoadmap({ ...SURYEON, orders: [...SURYEON.orders, { bookName: "가우스 중2-2-4권", date: "2026-10-01" }], reports: [], referenceDate: "2026-10-20" })!;
    expect(r).toMatchObject({ orderTitle: "가우스 중2-2 3권", startDate: "2026-07-23" });
  });
  it("창 앞 권에 아직 있으면 0", () => {
    const r = bookRoadmap({ orders: [{ bookName: "가우스 중2-2 4권", date: "2026-10-01" }], catalog: CATALOG, today: "2026-10-20", grade: "중2",
      reports: [{ date: "2026-10-13", textbook: "가우스 중2-2 3권", progress: "수학 삼각형의 닮음 조건" }], referenceDate: "2026-10-20" })!;
    expect(currentWindow(r).done).toBe(0);
    expect(r.position?.title).toBe("가우스 중2-2 3권");
  });
  it("교재목록에 없는 주문은 무시", () => {
    expect(latestOrderedBook([{ bookName: "쎈 중2-2", date: "2026-10-01" }], CATALOG)).toBeNull();
  });
});

describe("교재목록에 없는 교재", () => {
  it("이름별로 묶고(띄어쓰기·'중' 흔들림 접기) 교재목록 교재는 빼며 최신순", async () => {
    const { otherBooks } = await import("./book-plans");
    const r = otherBooks([
      { date: "2026-09-02", textbook: "수매씽  2-2", progress: "수학 내신대비", className: "개별 JJ3L" },
      { date: "2026-09-23", textbook: "수매씽 중2-2", progress: "수학 평행선과 삼각형의 넓이", className: "개별 JJ3L" },
      { date: "2026-09-18", textbook: "가우스 중2-2 3권,백발백중 2-2중간고사.", progress: null, className: "BS3O" },
      { date: "2026-10-30", textbook: "수매씽 2-2", progress: "미래", className: null },
    ], CATALOG, "2026-10-20");
    expect(r.map((b) => [b.name, b.records.map((x) => x.date)])).toEqual([
      ["수매씽 중2-2", ["2026-09-23", "2026-09-02"]],
      ["백발백중 2-2중간고사", ["2026-09-18"]],
    ]);
  });
});

describe("리뷰 보강", () => {
  const B11 = book("b11", "가우스 중1-1 1권", eight("일"));
  it("한 권만 교재목록에 있어도 관례 권은 빠지지 않는다", () => {
    expect(bookSequence("가우스|중1-1|1", [B11], 3).map((b) => b.title)).toEqual(["가우스 중1-1 1권", "가우스 중1-1 2권", "가우스 중1-2 3권"]);
  });
  it("중3인데 마감이 지났으면 지금 창 끝 · '마감 지남'", () => {
    const r = bookRoadmap({ orders: [{ bookName: "가우스 중2-2 4권", date: "2027-01-05" }], catalog: CATALOG, today: "2027-01-10", grade: "중3", reports: [], referenceDate: "2027-01-10" })!;
    expect(r).toMatchObject({ deadline: null, deadlinePassed: true });
    expect(r.books.map((b) => b.key)).toEqual(["가우스|중2-2|4", "가우스|중3-1|1"]);
  });
  it("초등 학생이어도 자동 목표는 중3-2를 넘지 않는다", () => {
    const r = bookRoadmap({ orders: [{ bookName: "가우스 중1-1 1권", date: "2026-03-02" }], catalog: [B11], today: "2026-03-10", grade: "초4", reports: [], referenceDate: "2026-03-10" })!;
    expect(r.target.key).toBe("가우스|중3-2|4");
  });
});
