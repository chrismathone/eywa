/**
 * 교재 3개월 창 — 전체 목표 로드맵([`book-roadmap.ts`](./book-roadmap.ts))의 **지금 창 하나**를 카드가 읽는 모양으로 접는다.
 *
 * 🔑 창 = 두 권(원장 2026-10-20 *"3개월당 교재 2권씩"* · *"4권 시작이면 바로 중3-1 교재로 자동으로 계속 넘어가게"*) —
 *    학기 경계에서 끊지 않는다. 창 길이 = 내신기간을 뺀 3개월이라 내신이 끼면 끝나는 날이 그만큼 늦다.
 * 🔴 계산은 로드맵이 한 번만 한다 — 여기서 날짜·계획을 다시 세지 않는다(두 숫자가 갈리지 않게).
 */
import { addDays } from "@/lib/date-kst";
import { matchedOrders, type BookOrder, type BookRoadmap } from "./book-roadmap";
import type { CatalogBook } from "./math-book-match";

export type { BookOrder } from "./book-roadmap";

export type WindowBook = {
  id: string;
  key: string;
  title: string;
  lessons: number;
  /** 첫 차시의 첫 소단원(타일 이름). 교재목록 미등록이면 null. */
  unit: string | null;
  /** 교재목록에 있는가 — 없으면 차시 수는 가정값. */
  listed: boolean;
  /** 차시별 소단원(마우스 오버 목록). */
  lessonUnits: string[][];
};

export type BookWindow = {
  books: WindowBook[];
  startDate: string;
  endDate: string;
  /** 이 창 안의 내신기간 날수(창이 그만큼 늘어났다). */
  examDays: number;
  /** 첫 창이면 그 창을 연 주문일, 이어진 창이면 null(주문 없이 자동으로 이어졌다). */
  orderDate: string | null;
  orderTitle: string;
  total: number;
  /** 창 안에서 나간 차시(누적). 진도를 못 읽으면 null. 창 앞 권에 아직 있으면 0. */
  done: number | null;
  planned: number;
  referenceDate: string;
  position: { title: string; lessonNo: number; total: number; date: string; unit: string } | null;
  nextClassDate: string | null;
};

/** 가장 최근 주문 교재 — 학생의 지금 교재(주문 = 그 학생 교재 등록). */
export function latestOrderedBook(orders: readonly BookOrder[], catalog: readonly CatalogBook[]): { book: CatalogBook; date: string } | null {
  const list = matchedOrders(orders, catalog);
  const last = list[list.length - 1];
  return last ? { book: last.book, date: last.date } : null;
}

/** 로드맵의 지금 창. `classDates`는 '다음 수업일'에만 쓴다. */
export function currentWindow(r: BookRoadmap, classDates?: (from: string, to: string) => string[]): BookWindow {
  const books = r.books.filter((b) => b.window === r.current);
  const before = r.books.filter((b) => b.window < r.current).reduce((n, b) => n + b.lessonCount, 0);
  const total = books.reduce((n, b) => n + b.lessonCount, 0);
  const clip = (v: number) => Math.max(0, Math.min(total, v - before));
  const startDate = books[0]!.startDate;
  const endDate = books[books.length - 1]!.finishDate;
  const examDays = r.exams.reduce((n, p) => {
    const a = p.from > startDate ? p.from : startDate, b = p.to < endDate ? p.to : endDate;
    return a > b ? n : n + Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
  }, 0);
  return {
    books: books.map((b) => ({
      id: b.catalog?.id ?? b.key,
      key: b.key,
      title: b.title,
      lessons: b.lessonCount,
      unit: b.lessonUnits[0]?.[0] ?? null,
      listed: b.catalog != null,
      lessonUnits: b.lessonUnits,
    })),
    startDate,
    endDate,
    examDays,
    orderDate: r.current === 0 ? r.orderDate : null,
    orderTitle: r.orderTitle,
    total,
    done: r.done == null ? null : clip(r.done),
    planned: clip(r.planned),
    referenceDate: r.referenceDate,
    position: r.position,
    nextClassDate: classDates?.(addDays(r.referenceDate, 1), addDays(r.referenceDate, 60))[0] ?? null,
  };
}
