import { describe, expect, it } from "vitest";
import { bookWindow, latestOrderedBook } from "./book-window";
import type { CatalogBook } from "./math-book-match";

const book = (id: string, title: string, units: string[]): CatalogBook => ({
  id, title, lessons: units.map((progress, i) => ({ lessonNo: i + 1, progress })),
});
const B1 = book("b1", "가우스 중2-1 1권", ["유리수와 소수", "지수법칙"]);
const B3 = book("b3", "가우스 중2-2 3권", ["이등변삼각형의 성질", "삼각형의 외심", "평행사변형의 성질", "닮은 도형"]);
const B4 = book("b4", "가우스 중2-2 4권", ["삼각형의 무게중심", "피타고라스 정리", "경우의 수", "확률의 계산"]);
const CATALOG = [B1, B3, B4];
const noDates = () => [] as string[];

describe("latestOrderedBook", () => {
  it("가장 최근 주문의 교재(교재명 표기 흔들림은 매핑으로)", () => {
    const r = latestOrderedBook([{ bookName: "가우스 중2-2 3권", date: "2026-07-22" }, { bookName: "가우스 중2-2-4권", date: "2026-10-08" }], CATALOG);
    expect(r?.book.id).toBe("b4");
  });
  it("교재목록에 없는 주문은 무시", () => {
    expect(latestOrderedBook([{ bookName: "쎈 중2-2", date: "2026-10-01" }], CATALOG)).toBeNull();
  });
});

describe("bookWindow", () => {
  it("3권 주문 → 3~4권 · 주문일+7일부터 3개월", () => {
    const w = bookWindow({ orders: [{ bookName: "가우스 중2-2 3권", date: "2026-07-22" }], catalog: CATALOG, reports: [], referenceDate: "2026-07-01", classDates: noDates });
    expect(w).toMatchObject({ startDate: "2026-07-29", endDate: "2026-10-28", total: 8, planned: 0, done: null });
    expect(w!.books.map((b) => b.id)).toEqual(["b3", "b4"]);
  });
  it("4권만 샀으면 4권만", () => {
    const w = bookWindow({ orders: [{ bookName: "가우스 중2-2 4권", date: "2026-10-08" }], catalog: CATALOG, reports: [], referenceDate: "2026-10-01", classDates: noDates });
    expect(w!.books.map((b) => b.id)).toEqual(["b4"]);
    expect(w!.total).toBe(4);
  });
  it("같은 학기 두 권을 3개월 안에 나눠 샀으면 먼저 산 날이 시작", () => {
    const w = bookWindow({ orders: [{ bookName: "가우스 중2-2 3권", date: "2026-07-22" }, { bookName: "가우스 중2-2 4권", date: "2026-10-08" }], catalog: CATALOG, reports: [], referenceDate: "2026-10-01", classDates: noDates });
    expect(w).toMatchObject({ orderTitle: "가우스 중2-2 3권", startDate: "2026-07-29", total: 8 });
  });
  it("먼저 산 날이 3개월보다 오래됐으면 새 창", () => {
    const w = bookWindow({ orders: [{ bookName: "가우스 중2-2 3권", date: "2026-03-02" }, { bookName: "가우스 중2-2 4권", date: "2026-10-08" }], catalog: CATALOG, reports: [], referenceDate: "2026-10-01", classDates: noDates });
    expect(w).toMatchObject({ orderTitle: "가우스 중2-2 4권", total: 4 });
  });
  it("계획 = 창 안 수업일에 고르게, 실제 = 누적 차시", () => {
    const dates = ["2026-08-01", "2026-08-15", "2026-09-01", "2026-09-15", "2026-10-01", "2026-10-15", "2026-10-20", "2026-10-25"];
    const w = bookWindow({
      orders: [{ bookName: "가우스 중2-2 3권", date: "2026-07-22" }],
      catalog: CATALOG,
      reports: [
        { date: "2026-09-01", textbook: "가우스 중2-2 3권", progress: "수학 닮은 도형" },
        { date: "2026-10-02", textbook: "가우스 중2-2 4권", progress: "수학 피타고라스 정리" },
      ],
      referenceDate: "2026-10-01",
      classDates: (from, to) => dates.filter((d) => d >= from && d <= to),
    });
    expect(w).toMatchObject({ planned: 5, done: 6 }); // 수업일 8일 중 5일 지남 → 8×5/8 · 3권 4 + 4권 2
    expect(w!.position).toMatchObject({ title: "가우스 중2-2 4권", lessonNo: 2 });
  });
  it("4권 창인데 아직 3권에 있으면 0", () => {
    const w = bookWindow({
      orders: [{ bookName: "가우스 중2-2 4권", date: "2026-10-08" }],
      catalog: CATALOG,
      reports: [{ date: "2026-10-13", textbook: "가우스 중2-2 3권", progress: "수학 닮은 도형" }],
      referenceDate: "2026-10-19",
      classDates: noDates,
    });
    expect(w).toMatchObject({ done: 0 });
    expect(w!.position?.title).toBe("가우스 중2-2 3권");
  });
  it("말일 시작도 3개월 뒤 말일로 접는다", () => {
    const w = bookWindow({ orders: [{ bookName: "가우스 중2-2 4권", date: "2026-11-23" }], catalog: CATALOG, reports: [], referenceDate: "2026-11-01", classDates: noDates });
    expect(w).toMatchObject({ startDate: "2026-11-30", endDate: "2027-02-27" });
  });
});
