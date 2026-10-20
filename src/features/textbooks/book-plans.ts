/**
 * 학생의 교재 계획 묶음 — 카드·선생님별 목록이 읽는 모양(순수 함수).
 *
 * 🔑 교재가 여럿이면 **교재 이름대로 나란히** 두고 눌러서 본다(원장 2026-10-20 *"여러교재쓰면 옆에 교재이름대로
 *    나열해서 클릭해서 보면될거같은데"*). 두 갈래:
 *    · 주문이 걸린 시리즈마다 로드맵 하나(가장 최근 주문 시리즈가 앞 = 주 교재)
 *    · 교재목록에 없는 교재(수요일 개별심화 반의 `수매씽 2-2` 등) — 차시표가 없어 계획은 못 세우고 최근 기록만 보여준다
 * 🔴 서버 재료(교재목록 원본·주문·보고서)는 여기서 끊는다 — 클라에는 그린 값만 내려간다.
 */
import { kstToday } from "@/lib/date-kst";
import { bookRoadmap, orderedSeries, type BookOrder, type BookRoadmap } from "./book-roadmap";
import { currentWindow, type BookWindow } from "./book-window";
import { matchCatalogBook, type CatalogBook } from "./math-book-match";
import type { SchoolExamOverride } from "./exam-periods";

export type PlanBook = {
  key: string;
  id: string | null;
  title: string;
  term: string;
  volume: number;
  lessonCount: number;
  lessonUnits: string[][];
  startDate: string;
  finishDate: string;
  window: number;
};
export type RoadmapView = Omit<BookRoadmap, "books"> & { books: PlanBook[]; window: BookWindow };
export type OtherBookRecord = { date: string; progress: string | null; className: string | null };
export type OtherBook = { name: string; records: OtherBookRecord[] };
export type StudentBookPlans = { roadmaps: RoadmapView[]; others: OtherBook[] };
export type AnyReportLine = { date: string; textbook: string | null; progress: string | null; className: string | null };

const OTHER_RECORDS = 6;

export function buildStudentBookPlans(args: {
  orders: readonly BookOrder[];
  catalog: readonly CatalogBook[];
  /** 이 반 보고서 — 진도 위치를 읽는다(반마다 진도가 오가서 다른 반 기록은 섞지 않는다). */
  reports: readonly { date: string; textbook: string | null; progress: string | null }[];
  /** 다른 반까지 포함한 최근 보고서 — 교재목록에 없는 교재를 찾는다. */
  allReports?: readonly AnyReportLine[];
  grade: string | null;
  /** 시리즈 → 사람이 고른 목표 권 열쇠. */
  targets?: Readonly<Record<string, string>>;
  referenceDate: string;
  today?: string;
  /** 그 학생 학교가 적어 둔 내신기간(없으면 기본표). */
  examOverrides?: readonly SchoolExamOverride[];
  classDates?: (from: string, to: string) => string[];
}): StudentBookPlans {
  const today = args.today ?? kstToday();
  const roadmaps: RoadmapView[] = [];
  for (const series of orderedSeries(args.orders, args.catalog)) {
    const r = bookRoadmap({
      orders: args.orders, catalog: args.catalog, reports: args.reports, referenceDate: args.referenceDate, today,
      grade: args.grade, series, targetKey: args.targets?.[series] ?? null, classDates: args.classDates,
      examOverrides: args.examOverrides,
    });
    if (!r) continue;
    roadmaps.push({
      ...r,
      books: r.books.map((b) => ({
        key: b.key, id: b.catalog?.id ?? null, title: b.title, term: b.term, volume: b.volume, lessonCount: b.lessonCount,
        lessonUnits: b.lessonUnits, startDate: b.startDate, finishDate: b.finishDate, window: b.window,
      })),
      window: currentWindow(r, args.classDates),
    });
  }
  return { roadmaps, others: otherBooks(args.allReports ?? [], args.catalog, args.referenceDate) };
}

/** 교재목록에 없는 교재 이름별 최근 기록. `가우스 중2-2 3권,백발백중 2-2중간고사.`는 조각마다 본다. */
export function otherBooks(reports: readonly AnyReportLine[], catalog: readonly CatalogBook[], referenceDate: string): OtherBook[] {
  const groups = new Map<string, OtherBook>();
  const series = [...new Set(catalog.map((b) => b.title.trim().split(/\s+/)[0]!).filter((s) => s && !/\d/.test(s)))];
  const sorted = [...reports].filter((r) => r.date <= referenceDate).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const r of sorted) {
    for (const raw of (r.textbook ?? "").split(/[\n\r,]+/)) {
      const name = raw.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
      // 교재가 아닌 조각(`프린트`·`복습`)과 교재목록 시리즈의 권 없는 표기(`가우스 중2-2`)는 칩으로 세우지 않는다.
      if (!name || !/\d/.test(name) || matchCatalogBook(name, catalog) || series.some((s) => name.includes(s))) continue;
      // `수매씽 2-2` · `수매씽 중2-2`는 같은 책 — 띄어쓰기와 학년 앞 `중`을 접어 한 칩으로.
      const key = name.replace(/\s/g, "").replace(/[초중고](?=\d-\d)/g, "");
      const g = groups.get(key) ?? { name, records: [] };
      if (g.records.length < OTHER_RECORDS) g.records.push({ date: r.date, progress: r.progress, className: r.className });
      groups.set(key, g);
    }
  }
  return [...groups.values()];
}
