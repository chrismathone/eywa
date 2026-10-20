/**
 * 교재 로드맵의 날짜 계산 — 순수 함수. 내신 아닌 날(작업일)을 세는 달력 + 권 배치 + **앞서 나간 학생 재계산**.
 *
 * 🔑 배치(원래 계획): 두 권씩 한 창, 한 창 = 달력 3개월치 날수만큼의 작업일. 창 안 두 권은 차시 비율로 나눈다.
 * 🔑 재계산(원장 2026-10-20 *"현재 권수가 미리 끝나고 다음 책으로 넘어가면 계획 재계산해서 다시 뿌리기"*):
 *    학생이 계획상 오늘 있어야 할 권보다 **뒤 권**에 있으면, 나간 차시는 시작~오늘에 차시 비율로 접고
 *    남은 차시는 오늘부터 원래 속도로 다시 편다. 늦은 학생은 재계산하지 않는다(밀린 만큼이 그대로 보여야 한다).
 */
import { addDays, shiftMonth } from "@/lib/date-kst";
import { examOn, type ExamPeriod } from "./exam-periods";
import type { SeqBook } from "./book-sequence";

export type PlacedBook = SeqBook & { startDate: string; finishDate: string; window: number };

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

/** 작업일(내신 아닌 날) 달력. */
export function workCalendar(exams: readonly ExamPeriod[]) {
  const off = (d: string) => examOn(exams, d) != null;
  /** `from`부터 작업일 n번째(포함, n ≥ 1). */
  const nth = (from: string, n: number) => {
    let d = from, count = 0;
    for (;;) { if (!off(d)) count++; if (count >= Math.max(1, n)) return d; d = addDays(d, 1); }
  };
  /** `from`~`to` 작업일 수(양끝 포함). */
  const count = (from: string, to: string) => {
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) if (!off(d)) n++;
    return n;
  };
  return { off, nth, count };
}
export type WorkCalendar = ReturnType<typeof workCalendar>;

/** 원래 계획 — `seq`를 `start`부터 두 권씩 한 창으로 놓는다. `until`을 넘긴 창까지(최소 `minBooks`권). */
export function placeBooks(seq: readonly SeqBook[], start: string, cal: WorkCalendar, until: string, minBooks: number, perWindow: number, months: number): PlacedBook[] {
  const out: PlacedBook[] = [];
  let windowStart = start;
  for (let i = 0; i < seq.length; i += perWindow) {
    const group = seq.slice(i, i + perWindow);
    const span = daysBetween(windowStart, addMonths(windowStart, months));
    const lessons = group.reduce((n, b) => n + b.lessonCount, 0);
    let cum = 0, bookStart = windowStart;
    for (const b of group) {
      cum += b.lessonCount;
      const finish = cal.nth(windowStart, Math.ceil((span * cum) / lessons));
      out.push({ ...b, startDate: bookStart, finishDate: finish, window: i / perWindow });
      bookStart = addDays(finish, 1);
    }
    windowStart = bookStart;
    if (out[out.length - 1]!.finishDate > until && out.length >= minBooks) break;
  }
  return out;
}

/** 누적 n차시를 그 배치가 끝내는 날 — 권 안에서는 작업일 비율로(계획과 같은 규칙). */
export function dateAtLessonsIn(books: readonly PlacedBook[], cal: WorkCalendar, n: number): string {
  if (n <= 0) return books[0]!.startDate;
  let before = 0;
  for (const b of books) {
    if (n <= before + b.lessonCount) return cal.nth(b.startDate, Math.ceil(((n - before) / b.lessonCount) * cal.count(b.startDate, b.finishDate)));
    before += b.lessonCount;
  }
  return books[books.length - 1]!.finishDate;
}

/**
 * 앞서 나간 학생 재계산. `done` = 나간 누적 차시(0보다 크다), `ref` = 기준일(시작 이후).
 * 작업일 번호(시작부터 1, 2, …)로 옮겨 계산한다 — 차시 n의 새 번호 = n ≤ done이면 오늘까지를 차시 비율로,
 * 넘으면 오늘 + (원래 번호 − 원래 done 번호).
 */
export function rebaseAhead(books: readonly PlacedBook[], start: string, cal: WorkCalendar, done: number, ref: string): PlacedBook[] {
  const idxOf = (d: string) => (d < start ? 0 : cal.count(start, d));
  const ends = books.map((b) => idxOf(b.finishDate));
  const before = books.map((_, i) => books.slice(0, i).reduce((n, b) => n + b.lessonCount, 0));
  const origIdx = (n: number) => {
    const i = books.findIndex((b, k) => n <= before[k]! + b.lessonCount);
    if (i < 0) return ends[ends.length - 1]!;
    const from = i === 0 ? 0 : ends[i - 1]!;
    return from + ((n - before[i]!) / books[i]!.lessonCount) * (ends[i]! - from);
  };
  const today = idxOf(ref);
  const shift = origIdx(done) - today;
  const newIdx = (n: number) => (n <= done ? (today * n) / done : origIdx(n) - shift);
  // 지금 권 = 나간 차시가 걸린 권. 그 앞 권들은 다 끝났다 — 날 수가 모자라면 **같은 날을 나눠 쓴다**
  // (하루씩 밀면 끝난 권이 오늘 뒤로 밀려 지금 권이 미래에서 시작한다 — 적대적 리뷰 2026-10-20).
  const cur = books.findIndex((b, k) => done <= before[k]! + b.lessonCount);
  const out: PlacedBook[] = [];
  let bookStart = start;
  books.forEach((b, i) => {
    let finish = cal.nth(start, Math.ceil(newIdx(before[i]! + b.lessonCount)));
    let from = bookStart;
    if (i < cur) {
      if (finish > ref) finish = ref;
      if (from > finish) from = finish;
    } else if (i === cur) {
      if (from > ref) from = ref;
      if (finish < ref) finish = ref;
    } else if (finish < from) finish = from;
    out.push({ ...b, startDate: from, finishDate: finish });
    bookStart = i < cur && finish >= ref ? ref : addDays(finish, 1);
  });
  return out;
}
