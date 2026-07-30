// 반별 시트의 주차 탭 제목 → 그 주 월요일. 순수(Vitest).
//
// 실측 제목 변형(2026-07-30, 28개 문서 98탭): `7/27-31 출석부/수업계획서` · `7/27-31출석부/수업계획서`(공백 없음)
// · `7/20-24 출석부/수업계획서의 사본` · `7/27-7/31 출석부/수업계획서`(끝에도 월) · `7/26-31 …`(시작이 일요일)
// · `7/13-17 출석부/수업계획서 `(끝 공백).
//
// 🔴 월요일은 **끝 날짜**에서 역산한다. `7/26-31`처럼 시작이 일요일인 제목이 실재하는데(입력 실수),
//    시작일로 mondayOf를 하면 ISO 규약상 **한 주 앞(7/20)**으로 밀려 남의 주에 데이터가 들어간다.
//    끝 날짜(7/31=금)로 역산하면 7/27로 정확히 떨어진다 — 실측 98탭 전부 이 규칙으로 맞는다.
//    시작·끝의 월요일이 어긋나면 `ambiguous`로 표시해 미리보기에 노출한다(조용히 고르지 않는다).
import { mondayOf } from "@/features/timetable/lib/week";

export type WeekTitleParse =
  | { ok: true; monday: string; startDate: string; endDate: string; ambiguous: boolean }
  | { ok: false; reason: string };

/** 주차 탭인가 — 제목에 '출석부' 또는 '수업계획'이 들어간 탭만 주차로 본다(데이터·실결제 탭 제외). */
export function isWeekTabTitle(title: string): boolean {
  return /출석부|수업계획/.test(title);
}

// `M/D-D` 또는 `M/D-M/D` (구분자 `-`·`~`·`–`). 뒤에 무엇이 붙든 앞부분만 읽는다.
const RANGE_RE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*[-~–]\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})/;

const pad = (n: number) => String(n).padStart(2, "0");

function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const s = `${year}-${pad(month)}-${pad(day)}`;
  // 실존 날짜 확인(2/30 같은 오타를 조용히 통과시키지 않는다).
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) return null;
  return s;
}

/**
 * 주차 탭 제목을 해석한다. `year`는 문서가 연도를 안 적어 호출부가 넘긴다(마스터 문서 제목의 4자리 연도).
 * ⚠️ 연말·연초에 걸친 주(12/28-1/1)는 끝 날짜의 월이 시작보다 작으면 연도를 +1 한다.
 */
export function parseWeekTabTitle(title: string, year: number): WeekTitleParse {
  const m = RANGE_RE.exec(title);
  if (!m) return { ok: false, reason: "제목에서 날짜 범위를 찾을 수 없습니다" };
  const sMonth = Number(m[1]);
  const sDay = Number(m[2]);
  const eMonth = m[3] ? Number(m[3]) : sMonth;
  const eDay = Number(m[4]);
  const startDate = ymd(year, sMonth, sDay);
  // 끝 월이 시작 월보다 작으면 해가 넘어간 주(12/28-1/1).
  const endDate = ymd(eMonth < sMonth ? year + 1 : year, eMonth, eDay);
  if (!startDate || !endDate) return { ok: false, reason: "실존하지 않는 날짜입니다" };
  const monday = mondayOf(endDate);
  return { ok: true, monday, startDate, endDate, ambiguous: mondayOf(startDate) !== monday };
}
