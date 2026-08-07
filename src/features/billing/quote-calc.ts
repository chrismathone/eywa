// 수강료 견적(신입생 상담) 순수 계산 — ijw 수강료 계산기의 다과목 월별 분할·합계를 이식.
// UI·DB 비의존(Vitest 강제). 날짜는 "YYYY-MM-DD" 문자열 + countSessions(UTC) 재사용.
import { countSessions } from "./tuition-calc";

// ── 견적 입력 구조(클라/서버 공용 — server-only 금지 모듈) ──
export type QuoteStudent = {
  name: string;
  school: string;
  grade: string;
  consultant: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
};

export type QuoteCourse = {
  uid: string;
  category: string; // 수학/EIE/영어/국어/기타
  name: string; // 반 이름 (예: "중등M 정규반 (3T2H)")
  days: string; // "월,수,목"
  perSession: number; // 회당 단가(단가표)
  sessions: number; // 총 시수(자동 산출 또는 수기)
  price: number; // 총 금액(자동=perSession×sessions 또는 수기)
  note: string; // 비고
  excludeHolidays: boolean; // 공휴일 제외(자동 시수 계산 시)
  fixedMonthly: boolean; // 월 N회 고정(보강 등 — 자동분할 우회)
};

export type QuoteExtra = { uid: string; name: string; price: number; note: string };
export type QuoteDiscount = { uid: string; name: string; amount: number };

export type MonthlyLine = {
  month: string; // "6월"
  category: string;
  name: string;
  days: string;
  sessions: number;
  price: number;
  note: string;
  isSubtotal?: boolean;
};

const DAY_INDEX: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/**
 * "월,수,금" · "월수금" · "월 수 금" · "월/수/금" → [1,3,5] (0=일~6=토).
 *
 * 🔴 예전엔 `split(",")`만 해서 **쉼표를 안 쓰면 통째로 오타 취급**됐다 — "월수목"을 넣으면
 *    요일이 0개로 읽혀 시수가 0이 됐다(원장 제보 2026-08-07: *"월수목 등 요일을 넣어도 시수가 0"*).
 *    placeholder가 "월,수,금"이라 쉼표를 기대했지만, 사람은 붙여 쓰는 게 자연스럽다.
 *    → **글자 단위로 훑는다**. 구분자가 무엇이든(쉼표·공백·중점·슬래시) 상관없고, 요일 글자가 아닌
 *    문자는 그냥 무시된다. 같은 요일을 두 번 써도 한 번만 센다(시수가 부풀지 않게).
 */
export function parseDays(s: string): number[] {
  // ⚠️ "월요일"처럼 쓰면 '요일'의 **'일'이 일요일로** 잡힌다 — 글자 단위로 읽기 전에 걷어낸다.
  const cleaned = s.replace(/요일/g, "");
  const out: number[] = [];
  for (const ch of cleaned) {
    const n = DAY_INDEX[ch];
    if (n !== undefined && !out.includes(n)) out.push(n);
  }
  return out;
}

const DAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * 사람이 친 요일을 표준 표기로 — "월수목" → "월,수,목" (원장 지시 2026-08-07 *"자동으로 쉼표처리"*).
 * 입력 칸 blur에서 쓴다. 읽은 요일이 하나도 없으면 **빈 문자열**을 돌려주므로, 호출부는 그때
 * 원래 입력을 그대로 둬야 한다(오타를 통째로 지워 버리면 사용자가 뭘 쳤는지 잃는다).
 * 순서는 사람이 친 순서를 유지한다(시수 계산은 순서와 무관하다).
 */
export function formatDays(s: string): string {
  return parseDays(s)
    .map((n) => DAY_LABEL[n])
    .join(",");
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m=1~12
}

/** start~end가 걸치는 달마다 그 달 안의 실제 부분범위(start/end clamp)를 반환. */
function monthsBetween(
  startIso: string,
  endIso: string,
): { year: number; month: number; start: string; end: string }[] {
  if (!startIso || !endIso || endIso < startIso) return [];
  let y = Number(startIso.slice(0, 4));
  let m = Number(startIso.slice(5, 7));
  const ey = Number(endIso.slice(0, 4));
  const em = Number(endIso.slice(5, 7));
  if (!y || !m || !ey || !em) return [];
  const out: { year: number; month: number; start: string; end: string }[] = [];
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 120) {
    const mm = String(m).padStart(2, "0");
    const first = `${y}-${mm}-01`;
    const last = `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}`;
    out.push({
      year: y,
      month: m,
      start: first < startIso ? startIso : first,
      end: last > endIso ? endIso : last,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * 과목들을 월별 행으로 분할 — ijw enrollment-period 모드 이식.
 * - fixedMonthly: 단일 행(시작 달, 시수·금액 그대로).
 * - 그 외: 달마다 시수(요일×기간−공휴일) 카운트 → 금액을 시수 비례 분배(perSession 기준).
 *   2개월 이상이면 과목별 "소계" 행 추가. 0차시면 입력 시수·금액으로 단일 행(폴백).
 * holidays = 제외 후보 날짜("YYYY-MM-DD"). 과목 excludeHolidays=false면 그 과목엔 미적용.
 */
export function splitCoursesByMonth(
  courses: QuoteCourse[],
  startDate: string,
  endDate: string,
  holidays: string[],
): MonthlyLine[] {
  const startMonthLabel = `${Number(startDate.slice(5, 7)) || 1}월`;
  const out: MonthlyLine[] = [];

  for (const c of courses) {
    const base = { category: c.category, name: c.name, days: c.days, note: c.note };

    if (c.fixedMonthly) {
      out.push({ month: startMonthLabel, ...base, sessions: c.sessions, price: c.price });
      continue;
    }

    const wd = parseDays(c.days);
    const hol = c.excludeHolidays ? holidays : [];
    const monthly: MonthlyLine[] = [];
    for (const mo of monthsBetween(startDate, endDate)) {
      if (wd.length === 0) break;
      const s = countSessions(mo.start, mo.end, wd, hol);
      if (s > 0) monthly.push({ month: `${mo.month}월`, ...base, sessions: s, price: 0 });
    }

    // 🔴 이 표는 **학부모에게 나가는 안내문**이다. 행의 합은 반드시 그 과목의 금액(c.price)과
    //    같아야 한다 — 같은 종이에 소계와 최종 납부 금액이 나란히 인쇄되기 때문이다.
    const totalS = monthly.reduce((a, b) => a + b.sessions, 0);

    // 다시 센 시수 합이 화면의 시수와 다르면 **월별로 쪼개지 않는다.**
    // 갈리는 경로가 둘 다 실사용이다: ① 상담자가 시수 칸을 수기로 고쳤다(그게 합의된 회차다)
    // ② 저장 뒤 휴원일·공휴일이 바뀌어 지금 세면 다른 수가 나온다.
    // 쪼개면 표의 회차·금액이 화면과 달라진다 — 한 줄로 보여주는 편이 정직하다.
    if (monthly.length === 0 || totalS !== c.sessions) {
      out.push({ month: startMonthLabel, ...base, sessions: c.sessions, price: c.price });
      continue;
    }

    // 비례 분배 — **마지막 달이 반올림 잔돈을 흡수**해 Σ(행) === c.price를 보장한다.
    // (예전엔 달마다 독립 반올림이라 100,000원이 35,714+28,571+35,714 = 99,999원으로 새어
    //  소계와 총액이 1원 어긋났다. 위로도 아래로도 새서 규칙조차 없었다.)
    let acc = 0;
    monthly.forEach((ml, i) => {
      ml.price = i === monthly.length - 1 ? c.price - acc : Math.round((c.price * ml.sessions) / totalS);
      acc += ml.price;
    });

    if (monthly.length === 1) {
      out.push(monthly[0]);
    } else {
      out.push(...monthly);
      out.push({ month: "", ...base, sessions: totalS, price: c.price, isSubtotal: true });
    }
  }
  return out;
}

export type QuoteTotals = {
  courseTotal: number;
  extraTotal: number;
  discountTotal: number;
  total: number;
};

/** 최종 합계 — 과목 합 + 기타 합 − 할인 합(음수 방어). 과목 합은 원본 course.price 합(소계 중복 배제). */
export function quoteTotal(
  courses: QuoteCourse[],
  extras: QuoteExtra[],
  discounts: QuoteDiscount[],
): QuoteTotals {
  const courseTotal = courses.reduce((a, c) => a + Math.max(0, Math.round(c.price)), 0);
  const extraTotal = extras.reduce((a, e) => a + Math.max(0, Math.round(e.price)), 0);
  const discountTotal = discounts.reduce((a, d) => a + Math.max(0, Math.round(d.amount)), 0);
  return {
    courseTotal,
    extraTotal,
    discountTotal,
    total: Math.max(0, courseTotal + extraTotal - discountTotal),
  };
}

/** 과목 1건의 자동 시수(요일×기간, 공휴일 제외 옵션). 계산기에서 요일/기간 바뀔 때 호출. */
export function autoSessions(
  days: string,
  startDate: string,
  endDate: string,
  holidays: string[],
): number {
  return countSessions(startDate, endDate, parseDays(days), holidays);
}
