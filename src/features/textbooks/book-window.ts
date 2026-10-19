/**
 * 교재 3개월 창 — 순수 함수(원장 2026-10-19):
 *  *"교재 주문 시 해당 학생의 교재로 교재 등록되며 주문날 +7일 기준으로 학습 진도를 나가면 됨"*
 *  *"시작 기준 3개월로 — 예를 들어 2-2 1을 구매했으면 2-2 2 완료까지 3개월로 잡고 진행 현황 볼 수 있도록"*
 *
 * 🔑 창 = **주문한 권 ~ 그 학기 마지막 권**(같은 시리즈·학교급·학년-학기 묶음, 교재목록 권 번호 순).
 *    가우스 중2-2는 3·4권이라 3권을 사면 3~4권(16차시), 4권만 샀으면 4권(8차시).
 * 🔑 시작 = 주문일 + 7일(책이 오는 시간), 끝 = 시작 + 3개월 − 1일.
 *    같은 묶음을 두 번 나눠 샀으면(3권 7월 → 4권 10월) **먼저 산 날**이 창의 시작이다 — 두 권을 3개월에 끝낸다는 약속이라
 *    4권 주문으로 창을 다시 열면 늦어진 만큼이 사라진다. 단 먼저 산 날이 3개월보다 오래됐으면 새 창으로 본다.
 * 🔑 계획 = 창 안 **실제 수업일**(학생 등원 요일·휴원·수강 기간 반영, `learningClassDates`)에 차시를 고르게 나눈 값.
 * ⚠️ 주문 기록은 사실이고 이건 그 위의 **약속**이다 — DB에 아무것도 쓰지 않는다(매 조회 계산).
 */
import { addDays, shiftMonth } from "@/lib/date-kst";
import { bookPosition, catalogBookKey, matchCatalogBook, type BookPosition, type CatalogBook, type ReportLine } from "./math-book-match";

export const BOOK_WINDOW_DAYS_AFTER_ORDER = 7;
export const BOOK_WINDOW_MONTHS = 3;

export type BookOrder = { bookName: string; date: string };

export type BookWindow = {
  /** 창이 묶는 권들(권 번호 순). */
  books: { id: string; title: string; lessons: number }[];
  /** 창의 시작 = 첫 주문일 + 7일. */
  startDate: string;
  endDate: string;
  /** 창이 다루는 소단원(권·차시 순) — 전체 목표 레일 위에 이 창이 차지하는 구간을 찾는 열쇠. */
  units: string[];
  /** 교재 학년(`중2`) — 같은 소단원 이름이 다른 학년에도 있어(`경우의 수` = 중2·공통수학1) 레일 구간을 이 학년으로 좁힌다. */
  grade: string;
  /** 창을 연 주문(가장 먼저 산 권). */
  orderDate: string;
  orderTitle: string;
  total: number;
  /** 창 안에서 나간 차시(누적). 진도를 못 읽으면 null. 창 앞 권에 아직 있으면 0. */
  done: number | null;
  /** 기준일까지 계획된 차시. */
  planned: number;
  /** 계획을 잰 기준일(화면이 '시작 전'을 가를 때 같은 날을 쓰게 — 클라 시계를 보지 않는다). */
  referenceDate: string;
  /** 진도를 준 기록. */
  position: (BookPosition & { title: string }) | null;
};

/** 같은 학기 묶음 열쇠 — `가우스|중2-2|3` → `가우스|중2-2`. */
function setKeyOf(title: string): string | null {
  const key = catalogBookKey(title);
  return key ? key.slice(0, key.lastIndexOf("|")) : null;
}
function volumeOf(title: string): number {
  const key = catalogBookKey(title);
  return key ? Number(key.slice(key.lastIndexOf("|") + 1)) : 0;
}

/** 주문 목록 → 교재목록 교재와 날짜. 못 읽는 교재명은 버린다. */
function matchedOrders(orders: readonly BookOrder[], catalog: readonly CatalogBook[]) {
  return orders
    .map((o) => ({ ...o, book: matchCatalogBook(o.bookName, catalog) }))
    .filter((o): o is BookOrder & { book: CatalogBook } => !!o.book)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 가장 최근 주문 교재 — 학생의 지금 교재(주문 = 그 학생 교재 등록). */
export function latestOrderedBook(orders: readonly BookOrder[], catalog: readonly CatalogBook[]): { book: CatalogBook; date: string } | null {
  const list = matchedOrders(orders, catalog);
  const last = list[list.length - 1];
  return last ? { book: last.book, date: last.date } : null;
}

/**
 * 학생의 교재 3개월 창. 주문이 없거나 교재목록에서 못 읽으면 null.
 * `classDates(from, to)` = 그 학생의 실제 수업일(호출부가 `learningClassDates`로 넘긴다).
 */
export function bookWindow(args: {
  orders: readonly BookOrder[];
  catalog: readonly CatalogBook[];
  reports: readonly ReportLine[];
  referenceDate: string;
  classDates: (from: string, to: string) => string[];
}): BookWindow | null {
  const { catalog, reports, referenceDate, classDates } = args;
  const list = matchedOrders(args.orders, catalog);
  const latest = list[list.length - 1];
  if (!latest) return null;
  const setKey = setKeyOf(latest.book.title);
  if (!setKey) return null;
  // 같은 묶음의 주문 중, 최근 주문에서 3개월 안쪽의 가장 이른 것이 창을 연다.
  const horizon = addMonths(latest.date, -BOOK_WINDOW_MONTHS);
  const opener = list.find((o) => setKeyOf(o.book.title) === setKey && o.date >= horizon) ?? latest;

  const fromVol = volumeOf(opener.book.title);
  const books = catalog
    .filter((b) => setKeyOf(b.title) === setKey && volumeOf(b.title) >= fromVol)
    .sort((a, b) => volumeOf(a.title) - volumeOf(b.title));
  if (books.length === 0) return null;
  const total = books.reduce((n, b) => n + b.lessons.length, 0);

  const startDate = addDays(opener.date, BOOK_WINDOW_DAYS_AFTER_ORDER);
  const endDate = addDays(addMonths(startDate, BOOK_WINDOW_MONTHS), -1);

  // 계획 — 창 안 수업일에 차시를 고르게. 수업일이 없으면(시간표 미상) 달력 날짜로 나눈다.
  const dates = classDates(startDate, endDate);
  let planned: number;
  if (referenceDate < startDate) planned = 0;
  // 반올림 — 내림이면 초반 몇 주가 늘 '계획 0'이라 빠름으로만 읽힌다(실화면 2026-10-19: 8차시 · 수업 4번 지남 → 0.8 → 0).
  else if (dates.length > 0) planned = Math.round((total * dates.filter((d) => d <= referenceDate).length) / dates.length);
  else {
    const span = daysBetween(startDate, endDate) + 1;
    planned = Math.min(total, Math.round((total * (daysBetween(startDate, referenceDate) + 1)) / span));
  }

  // 실제 — 같은 학기 묶음 전체에서 진도가 걸린 **가장 최근** 기록(같은 날이면 뒤 권). 창 앞 권에 있으면 0.
  const setBooks = catalog
    .filter((b) => setKeyOf(b.title) === setKey)
    .sort((a, b) => volumeOf(a.title) - volumeOf(b.title));
  let position: BookWindow["position"] = null;
  let done: number | null = null;
  for (const b of setBooks) {
    const p = bookPosition(b, reports, catalog);
    if (!p || (position && p.date < position.date)) continue;
    position = { ...p, title: b.title };
    const index = books.findIndex((w) => w.id === b.id);
    done = index < 0 ? 0 : books.slice(0, index).reduce((n, w) => n + w.lessons.length, 0) + p.lessonNo;
  }
  return {
    books: books.map((b) => ({ id: b.id, title: b.title, lessons: b.lessons.length })),
    grade: setKey.split("|")[1]!.replace(/-\d+$/, ""),
    units: books.flatMap((b) => b.lessons.flatMap((l) => (l.progress ?? "").split(" / ").map((u) => u.trim()).filter(Boolean))),
    startDate,
    endDate,
    orderDate: opener.date,
    orderTitle: opener.book.title,
    total,
    done,
    planned,
    referenceDate,
    position,
  };
}

/** 날짜 + N개월 — 말일은 그 달 말일로 접는다(11-30 + 3개월 = 2-28). */
function addMonths(date: string, n: number): string {
  const month = shiftMonth(date.slice(0, 7), n);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), last)).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
