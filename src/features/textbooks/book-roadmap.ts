/**
 * 교재 전체 목표(로드맵) — 순수 함수(원장 2026-10-20):
 *  *"학생이 교재주문한 시점부터 … 그학생이 중3 11월말 까지 3개월당 교재 2권씩 끊으면 어디 교재까지 나갈수있는지
 *   자동으로 목표 설정"* · *"내신기간때는 진도가 나가면 안됌 기간에서 제외"* · *"최종목표 … 수정되게도 교재단위로"*
 *
 * 🔑 시작 = 지금 창을 연 주문일 + 7일. 그 권부터 **두 권씩 한 창**, 한 창 = **내신기간을 뺀 3개월**(달력 3개월치 날수만큼
 *    내신 아닌 날이 쌓이면 창이 끝난다). 창 안 두 권은 차시 수 비율로 나눈다. 창이 끝나면 다음 두 권이 이어 연다
 *    (학기·학년 경계와 무관 — 중2-2 4권 다음은 중3-1 1권).
 * 🔑 자동 최종 목표 = **중3 11월 말에 나가고 있을 권**(나이 기준 — 권 이름으로 막지 않는다). 사람이 고르면 그 권
 *    (속도는 그대로, 끝나는 날만 바뀐다). 앞서 나가 다음 권으로 넘어가면 오늘부터 다시 편다(roadmap-calendar.ts).
 * 🔑 계획(오늘 계획 N차시) = 권마다 그 권 기간의 내신 아닌 날 중 지난 비율 — 내신기간엔 늘지 않는다.
 * ⚠️ 주문 기록은 사실이고 이건 그 위의 **약속**이다 — DB에 쓰지 않는다(매 조회 계산). 목표 권 선택만 저장된다.
 */
import { addDays } from "@/lib/date-kst";
import { catalogBookKey, matchCatalogBook, type CatalogBook, type ReportLine } from "./math-book-match";
import { latestPosition, windowAt } from "./roadmap-position";
import { bookSequence, keyOrdinal, seriesOfKey } from "./book-sequence";
import { examOn, examPeriodsBetween, gradeOrdinal, middleSchoolDeadline, type SchoolExamOverride } from "./exam-periods";
import { addMonths, dateAtLessonsIn, daysBetween, placeBooks, rebaseAhead, workCalendar, type PlacedBook } from "./roadmap-calendar";

export const ROADMAP_DAYS_AFTER_ORDER = 7;
export const ROADMAP_WINDOW_MONTHS = 3;
export const BOOKS_PER_WINDOW = 2;

export type { BookOrder, RoadBook, ScheduleBook, RoadmapStatus, RoadPosition, BookRoadmap } from "./book-roadmap-types";
import type { BookOrder, ScheduleBook, RoadmapStatus, BookRoadmap } from "./book-roadmap-types";

export { addMonths, daysBetween } from "./roadmap-calendar";

/** 주문 목록 → 교재목록 열쇠와 날짜(날짜순). 못 읽는 교재명은 버린다. */
export function matchedOrders(orders: readonly BookOrder[], catalog: readonly CatalogBook[]) {
  return orders
    .map((o) => {
      const book = matchCatalogBook(o.bookName, catalog);
      const key = book ? catalogBookKey(book.title) : null;
      return book && key ? { ...o, book, key } : null;
    })
    .filter((o): o is BookOrder & { book: CatalogBook; key: string } => !!o)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 주문이 걸린 시리즈들 — 가장 최근 주문 시리즈가 앞(학생의 주 교재). */
export function orderedSeries(orders: readonly BookOrder[], catalog: readonly CatalogBook[]): string[] {
  const list = matchedOrders(orders, catalog).reverse();
  return [...new Set(list.map((o) => seriesOfKey(o.key)).filter((s): s is string => !!s))];
}

export function bookRoadmap(args: {
  orders: readonly BookOrder[];
  catalog: readonly CatalogBook[];
  reports: readonly ReportLine[];
  referenceDate: string;
  today: string;
  grade: string | null;
  series?: string;
  targetKey?: string | null;
  classDates?: (from: string, to: string) => string[];
  /** 그 학생 학교가 적어 둔 내신기간(없으면 기본표). */
  examOverrides?: readonly SchoolExamOverride[];
}): BookRoadmap | null {
  const { catalog, referenceDate: ref, today } = args;
  const list = matchedOrders(args.orders, catalog).filter((o) => !args.series || seriesOfKey(o.key) === args.series);
  const latest = list[list.length - 1];
  if (!latest) return null;
  // 창을 연 주문 — 최근 주문에서 3개월 안쪽이고 최근 주문 권 **바로 앞까지**인 가장 이른 주문(두 권 한 창).
  const horizon = addMonths(latest.date, -ROADMAP_WINDOW_MONTHS);
  const opener = list.find((o) => o.date >= horizon
    && (o.key === latest.key || bookSequence(o.key, catalog, 2)[1]?.key === latest.key)) ?? latest;
  const series = seriesOfKey(opener.key)!;

  const ordinal = gradeOrdinal(args.grade);
  const deadline = middleSchoolDeadline(ordinal, today);
  const start = addDays(opener.date, ROADMAP_DAYS_AFTER_ORDER);
  const exams = examPeriodsBetween(ordinal, today, start, addDays(start, 365 * 8), args.examOverrides ?? []);
  const cal = workCalendar(exams);

  // 원래 계획 — 마감(없으면 기준일) 뒤로 1년 넘게, 고른 목표까지는 반드시 펼친다.
  const seq = bookSequence(opener.key, catalog);
  const overrideIdx = args.targetKey ? seq.findIndex((b) => b.key === args.targetKey) : -1;
  const until = addDays(deadline && deadline > ref ? deadline : ref, 400);
  let placed = placeBooks(seq, start, cal, until, Math.max(6, overrideIdx + 1), BOOKS_PER_WINDOW, ROADMAP_WINDOW_MONTHS);
  if (placed.length === 0) return null;

  // 진도 — 시리즈 교재 중 가장 최근 기록. 원래 계획 위 누적 차시.
  const position = latestPosition(series, catalog, args.reports);
  const cumBefore = (books: readonly PlacedBook[], key: string) => {
    const i = books.findIndex((b) => b.key === key);
    return i < 0 ? null : books.slice(0, i).reduce((n, b) => n + b.lessonCount, 0);
  };
  const posBefore = position ? cumBefore(placed, position.key) : null;
  const doneAll = position == null ? null
    : posBefore != null ? posBefore + Math.min(position.lessonNo, placed.find((b) => b.key === position.key)!.lessonCount)
    : keyOrdinal(position.key) < keyOrdinal(placed[0]!.key) ? 0 : null;

  // 앞서 나가 **다음 권으로 넘어갔으면** 오늘부터 다시 편다(원장 "미리 끝나고 다음 책으로 넘어가면 재계산").
  const planIdx = placed.findIndex((b) => b.startDate <= ref && ref <= b.finishDate);
  const posIdx = position ? placed.findIndex((b) => b.key === position.key) : -1;
  const rebased = ref >= start && planIdx >= 0 && posIdx > planIdx && doneAll != null && doneAll > 0;
  // 얼마나 앞섰나(일) — 원래 계획이 지금 나간 차시에 닿는 날까지(재계산 전 배치로 잰다).
  const origDoneDate = doneAll != null && doneAll > 0 ? dateAtLessonsIn(placed, cal, doneAll) : null;
  if (rebased) placed = rebaseAhead(placed, start, cal, doneAll!, ref);

  // 최종 목표 = **중3 11월 말에 나가고 있을 권**(원장 *"학생의 나이가 중3 11월 말일 때 기준으로"*) — 권 이름으로 막지 않는다.
  // 마감이 이미 지났거나(중3 12월~2월) 학년을 모르면 → 지금 창 끝(카드는 '마감 지남'으로 적는다).
  const deadlineUsable = deadline != null && deadline >= start && deadline >= ref;
  const atDeadline = deadlineUsable ? placed.findIndex((b) => b.finishDate >= deadline!) : -1;
  const autoIdx = deadlineUsable
    ? (atDeadline >= 0 ? atDeadline : placed.length - 1)
    : Math.max(0, placed.filter((b) => b.window <= windowAt(placed, ref)).length - 1);
  const targetIdx = overrideIdx >= 0 && overrideIdx < placed.length ? overrideIdx : autoIdx;
  const books = placed.slice(0, targetIdx + 1);
  const total = books.reduce((n, b) => n + b.lessonCount, 0);
  const endDate = books[books.length - 1]!.finishDate;
  const shownDeadline = deadlineUsable ? deadline : null;
  const schedule: ScheduleBook[] = placed.slice(0, (shownDeadline ? Math.max(targetIdx, autoIdx) : targetIdx) + 1).map((b) => ({
    key: b.key, title: b.title, startDate: b.startDate, finishDate: b.finishDate, lessonCount: b.lessonCount, window: b.window,
    lessonUnits: b.lessonUnits,
    byDeadline: shownDeadline && b.finishDate > shownDeadline && b.startDate <= shownDeadline
      ? Math.round((b.lessonCount * cal.count(b.startDate, shownDeadline)) / Math.max(1, cal.count(b.startDate, b.finishDate)))
      : null,
  }));
  const scheduleEnd = shownDeadline && shownDeadline > endDate ? shownDeadline : endDate;

  const done = doneAll == null ? (position ? total : null) : Math.min(doneAll, total);
  let plannedLessons = 0;
  for (const b of books) {
    if (ref < b.startDate) continue;
    if (ref >= b.finishDate) { plannedLessons += b.lessonCount; continue; }
    plannedLessons += (b.lessonCount * cal.count(b.startDate, ref)) / Math.max(1, cal.count(b.startDate, b.finishDate));
  }
  const plan = rebased ? done! : Math.round(plannedLessons);
  const difference = done == null ? null : done - plan;
  /** 누적 n차시를 계획이 끝내는 날 — 권 안에서는 작업일 비율로(계획과 같은 규칙). */
  const dateAtLessons = (n: number): string => {
    if (n <= 0) return books[0]!.startDate;
    let before = 0;
    for (const b of books) {
      if (n <= before + b.lessonCount) return cal.nth(b.startDate, Math.ceil(((n - before) / b.lessonCount) * cal.count(b.startDate, b.finishDate)));
      before += b.lessonCount;
    }
    return endDate;
  };
  const status: RoadmapStatus = ref < start ? "not-started" : done == null ? "no-data" : done >= total ? "done"
    : difference! < -1 ? "behind" : difference! > 1 ? "ahead" : "on";

  return {
    series,
    books,
    choices: placed.map((b) => ({ key: b.key, title: b.title, finishDate: b.finishDate })),
    schedule,
    scheduleEnd,
    target: { key: books[books.length - 1]!.key, auto: targetIdx === autoIdx && overrideIdx < 0, autoKey: placed[autoIdx]!.key },
    deadline: shownDeadline,
    deadlinePassed: deadline != null && !deadlineUsable,
    rebased,
    aheadDays: (rebased || status === "ahead") && origDoneDate && origDoneDate > ref ? daysBetween(ref, origDoneDate) : null,
    startDate: start,
    endDate,
    orderDate: opener.date,
    orderTitle: opener.book.title,
    exams: exams.filter((p) => p.to >= start && p.from <= scheduleEnd),
    examNow: ref >= start && ref <= endDate ? examOn(exams, ref) : null,
    total,
    done,
    planned: plan,
    difference,
    status,
    referenceDate: ref,
    position,
    remainingClasses: args.classDates ? args.classDates(addDays(ref, 1), endDate).filter((d) => !cal.off(d)).length : null,
    current: windowAt(books, ref),
    doneDate: done == null ? null : rebased ? ref : dateAtLessons(done),
  };
}
