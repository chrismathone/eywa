/**
 * 교재 전체 목표(로드맵) — 순수 함수(원장 2026-10-20):
 *  *"학생이 교재주문한 시점부터 … 그학생이 중3 11월말 까지 3개월당 교재 2권씩 끊으면 어디 교재까지 나갈수있는지
 *   자동으로 목표 설정"* · *"내신기간때는 진도가 나가면 안됌 기간에서 제외"* · *"최종목표 … 수정되게도 교재단위로"*
 *
 * 🔑 시작 = 지금 창을 연 주문일 + 7일. 그 권부터 **두 권씩 한 창**, 한 창 = **내신기간을 뺀 3개월**(달력 3개월치 날수만큼
 *    내신 아닌 날이 쌓이면 창이 끝난다). 창 안 두 권은 차시 수 비율로 나눈다. 창이 끝나면 다음 두 권이 이어 연다
 *    (학기·학년 경계와 무관 — 중2-2 4권 다음은 중3-1 1권).
 * 🔑 자동 최종 목표 = 중3 11월 말까지 **끝낼 수 있는 마지막 권**. 사람이 고르면 그 권(속도는 그대로, 끝나는 날만 바뀐다).
 * 🔑 계획(오늘 계획 N차시) = 권마다 그 권 기간의 내신 아닌 날 중 지난 비율 — 내신기간엔 늘지 않는다.
 * ⚠️ 주문 기록은 사실이고 이건 그 위의 **약속**이다 — DB에 쓰지 않는다(매 조회 계산). 목표 권 선택만 저장된다.
 */
import { addDays, shiftMonth } from "@/lib/date-kst";
import { bookPosition, catalogBookKey, matchCatalogBook, type CatalogBook, type ReportLine } from "./math-book-match";
import { bookSequence, keyOrdinal, seriesOfKey, type SeqBook } from "./book-sequence";
import { examOn, examPeriodsBetween, gradeOrdinal, middleSchoolDeadline, type ExamPeriod } from "./exam-periods";

export const ROADMAP_DAYS_AFTER_ORDER = 7;
export const ROADMAP_WINDOW_MONTHS = 3;
export const BOOKS_PER_WINDOW = 2;

export type BookOrder = { bookName: string; date: string };
export type RoadBook = SeqBook & { startDate: string; finishDate: string; window: number };
export type RoadmapStatus = "not-started" | "no-data" | "behind" | "on" | "ahead" | "done";
export type RoadPosition = { key: string; title: string; lessonNo: number; total: number; date: string; unit: string };

export type BookRoadmap = {
  series: string;
  /** 시작 권 ~ 목표 권. */
  books: RoadBook[];
  /** 고를 수 있는 목표 권(시작 권부터 자동 목표 몇 권 뒤까지) — 예상 완료일과 함께. */
  choices: { key: string; title: string; finishDate: string }[];
  target: { key: string; auto: boolean; autoKey: string };
  /** 중3 11월 말 — 자동 목표를 정한 마감. 고등·학년 미상·마감으로 못 정했으면 null. */
  deadline: string | null;
  /** 마감(중3 11월 말)이 있지만 이미 지났거나 첫 권도 못 끝내 지금 창 끝으로 정했다. */
  deadlinePassed: boolean;
  startDate: string;
  endDate: string;
  orderDate: string;
  orderTitle: string;
  /** 시작~목표 사이 내신기간(표시용). */
  exams: ExamPeriod[];
  examNow: ExamPeriod | null;
  total: number;
  done: number | null;
  planned: number;
  difference: number | null;
  status: RoadmapStatus;
  referenceDate: string;
  position: RoadPosition | null;
  /** 기준일 다음 날 ~ 목표 완료일의 내신 아닌 수업일. 수업일을 모르면 null. */
  remainingClasses: number | null;
  /** 기준일이 든 창(앞이면 0, 지났으면 마지막). */
  current: number;
};

/** 날짜 + N개월 — 말일은 그 달 말일로 접는다(11-30 + 3개월 = 2-28). */
export function addMonths(date: string, n: number): string {
  const month = shiftMonth(date.slice(0, 7), n);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

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
}): BookRoadmap | null {
  const { catalog, referenceDate: ref, today } = args;
  const list = matchedOrders(args.orders, catalog).filter((o) => !args.series || seriesOfKey(o.key) === args.series);
  const latest = list[list.length - 1];
  if (!latest) return null;
  // 창을 연 주문 — 최근 주문에서 3개월 안쪽이고 최근 주문 권 **바로 앞까지**인 가장 이른 주문(두 권 한 창).
  const horizon = addMonths(latest.date, -ROADMAP_WINDOW_MONTHS);
  const opener = list.find((o) => o.date >= horizon
    && (o.key === latest.key || bookSequence(o.key, catalog, 2)[1]?.key === latest.key)) ?? latest;

  const ordinal = gradeOrdinal(args.grade);
  const deadline = middleSchoolDeadline(ordinal, today);
  const start = addDays(opener.date, ROADMAP_DAYS_AFTER_ORDER);
  const exams = examPeriodsBetween(ordinal, today, start, addDays(start, 365 * 8));
  const off = (d: string) => examOn(exams, d) != null;
  /** `from`부터 내신 아닌 날 n번째(포함). */
  const nthWorkday = (from: string, n: number) => {
    let d = from, count = 0;
    for (;;) { if (!off(d)) count++; if (count >= n) return d; d = addDays(d, 1); }
  };
  const workdays = (from: string, to: string) => {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (!off(d)) n++;
    return n;
  };

  // 창마다 두 권 — 자동 목표가 정해지고 고른 목표·여유 몇 권까지 펼친다.
  const seq = bookSequence(opener.key, catalog);
  const overrideIdx = args.targetKey ? seq.findIndex((b) => b.key === args.targetKey) : -1;
  const planned: RoadBook[] = [];
  let windowStart = start;
  for (let i = 0; i < seq.length; i += BOOKS_PER_WINDOW) {
    const group = seq.slice(i, i + BOOKS_PER_WINDOW);
    const span = daysBetween(windowStart, addMonths(windowStart, ROADMAP_WINDOW_MONTHS));
    const lessons = group.reduce((n, b) => n + b.lessonCount, 0);
    let cum = 0, bookStart = windowStart;
    for (const b of group) {
      cum += b.lessonCount;
      const finish = nthWorkday(windowStart, Math.max(1, Math.ceil((span * cum) / lessons)));
      planned.push({ ...b, startDate: bookStart, finishDate: finish, window: i / BOOKS_PER_WINDOW });
      bookStart = addDays(finish, 1);
    }
    windowStart = bookStart;
    const autoKnown = deadline ? planned[planned.length - 1]!.finishDate > deadline : planned.some((b) => b.startDate > ref);
    if (autoKnown && planned.length > overrideIdx && planned.length >= 6) break;
  }
  if (planned.length === 0) return null;

  // 자동 목표는 중3-2를 넘지 않는다(원장 "중3 11월말까지" — 초등 주문이면 고등 권을 지어내지 않게).
  const cap = keyOrdinal(`${seriesOfKey(opener.key)}|중3-2|99`);
  const byDeadline = deadline ? planned.filter((b) => b.finishDate <= deadline && keyOrdinal(b.key) <= cap) : [];
  // 마감이 이미 지났거나(중3 12월~2월) 첫 권도 그 안에 못 끝내면 → 마감 대신 지금 창 끝(카드는 '마감 지남'으로 적는다).
  const deadlineUsable = byDeadline.length > 0;
  const fit = deadlineUsable ? byDeadline : planned.filter((b) => b.window <= windowAt(planned, ref));
  const autoIdx = Math.max(0, fit.length - 1);
  const targetIdx = overrideIdx >= 0 && overrideIdx < planned.length ? overrideIdx : autoIdx;
  const books = planned.slice(0, targetIdx + 1);
  const total = books.reduce((n, b) => n + b.lessonCount, 0);
  const endDate = books[books.length - 1]!.finishDate;

  let plannedLessons = 0;
  for (const b of books) {
    if (ref < b.startDate) continue;
    if (ref >= b.finishDate) { plannedLessons += b.lessonCount; continue; }
    plannedLessons += (b.lessonCount * workdays(b.startDate, ref)) / Math.max(1, workdays(b.startDate, b.finishDate));
  }
  const plan = Math.round(plannedLessons);

  const position = latestPosition(args.series ?? seriesOfKey(opener.key)!, catalog, args.reports);
  let done: number | null = null;
  if (position) {
    const at = books.findIndex((b) => b.key === position.key);
    done = at >= 0 ? books.slice(0, at).reduce((n, b) => n + b.lessonCount, 0) + Math.min(position.lessonNo, books[at]!.lessonCount)
      : keyOrdinal(position.key) < keyOrdinal(books[0]!.key) ? 0 : total;
  }
  const difference = done == null ? null : done - plan;
  const status: RoadmapStatus = ref < start ? "not-started" : done == null ? "no-data" : done >= total ? "done"
    : difference! < -1 ? "behind" : difference! > 1 ? "ahead" : "on";

  return {
    series: seriesOfKey(opener.key)!,
    books,
    choices: planned.map((b) => ({ key: b.key, title: b.title, finishDate: b.finishDate })),
    target: { key: books[books.length - 1]!.key, auto: targetIdx === autoIdx && overrideIdx < 0, autoKey: planned[autoIdx]!.key },
    deadline: deadlineUsable ? deadline : null,
    deadlinePassed: deadline != null && !deadlineUsable,
    startDate: start,
    endDate,
    orderDate: opener.date,
    orderTitle: opener.book.title,
    exams: exams.filter((p) => p.to >= start && p.from <= endDate),
    examNow: ref >= start && ref <= endDate ? examOn(exams, ref) : null,
    total,
    done,
    planned: plan,
    difference,
    status,
    referenceDate: ref,
    position,
    remainingClasses: args.classDates ? args.classDates(addDays(ref, 1), endDate).filter((d) => !off(d)).length : null,
    current: windowAt(books, ref),
  };
}

function windowAt(books: readonly RoadBook[], ref: string): number {
  const hit = books.find((b) => b.startDate <= ref && ref <= b.finishDate);
  if (hit) return hit.window;
  return ref < books[0]!.startDate ? 0 : books[books.length - 1]!.window;
}

/** 시리즈 교재 중 진도가 걸린 **가장 최근** 기록(같은 날이면 뒤 권). */
function latestPosition(series: string, catalog: readonly CatalogBook[], reports: readonly ReportLine[]): RoadPosition | null {
  let best: RoadPosition | null = null;
  for (const b of catalog) {
    const key = catalogBookKey(b.title);
    if (!key || seriesOfKey(key) !== series) continue;
    const p = bookPosition(b, reports, catalog);
    if (!p) continue;
    if (!best || p.date > best.date || (p.date === best.date && keyOrdinal(key) > keyOrdinal(best.key))) {
      best = { key, title: b.title, lessonNo: p.lessonNo, total: p.total, date: p.date, unit: p.unit };
    }
  }
  return best;
}
