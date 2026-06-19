// 대한민국 공휴일 — ijw-calander `utils/tuitionHolidays.ts`의 날짜를 이식 + 정확한 이름 부여(2024–2030).
// ijw 원본은 이름 맵이 양력 고정 8개뿐이라 설날/추석/부처님오신날/대체공휴일이 "공휴일"로 떴음 → 날짜별 이름 명시.
// 수강료 계산기의 "공휴일 제외" 토글 + 공휴일 면이 소비. ⚠️ server-only 금지 — 계산기(클라)도 import.

export type Holiday = { date: string; name: string };

export const KOREAN_HOLIDAYS: Record<number, Holiday[]> = {
  2024: [
    { date: "2024-01-01", name: "신정" },
    { date: "2024-02-09", name: "설날 연휴" },
    { date: "2024-02-10", name: "설날" },
    { date: "2024-02-11", name: "설날 연휴" },
    { date: "2024-02-12", name: "대체공휴일" },
    { date: "2024-03-01", name: "삼일절" },
    { date: "2024-04-10", name: "국회의원선거일" },
    { date: "2024-05-05", name: "어린이날" },
    { date: "2024-05-06", name: "대체공휴일" },
    { date: "2024-05-15", name: "부처님오신날" },
    { date: "2024-06-06", name: "현충일" },
    { date: "2024-08-15", name: "광복절" },
    { date: "2024-09-16", name: "추석 연휴" },
    { date: "2024-09-17", name: "추석" },
    { date: "2024-09-18", name: "추석 연휴" },
    { date: "2024-10-03", name: "개천절" },
    { date: "2024-10-09", name: "한글날" },
    { date: "2024-12-25", name: "성탄절" },
  ],
  2025: [
    { date: "2025-01-01", name: "신정" },
    { date: "2025-01-28", name: "설날 연휴" },
    { date: "2025-01-29", name: "설날" },
    { date: "2025-01-30", name: "설날 연휴" },
    { date: "2025-03-01", name: "삼일절" },
    { date: "2025-03-03", name: "대체공휴일" },
    { date: "2025-05-05", name: "어린이날·부처님오신날" },
    { date: "2025-05-06", name: "대체공휴일" },
    { date: "2025-06-06", name: "현충일" },
    { date: "2025-08-15", name: "광복절" },
    { date: "2025-10-03", name: "개천절" },
    { date: "2025-10-05", name: "추석 연휴" },
    { date: "2025-10-06", name: "추석" },
    { date: "2025-10-07", name: "추석 연휴" },
    { date: "2025-10-08", name: "대체공휴일" },
    { date: "2025-10-09", name: "한글날" },
    { date: "2025-12-25", name: "성탄절" },
  ],
  2026: [
    { date: "2026-01-01", name: "신정" },
    { date: "2026-02-16", name: "설날 연휴" },
    { date: "2026-02-17", name: "설날" },
    { date: "2026-02-18", name: "설날 연휴" },
    { date: "2026-03-01", name: "삼일절" },
    { date: "2026-03-02", name: "대체공휴일" },
    { date: "2026-05-05", name: "어린이날" },
    { date: "2026-05-24", name: "부처님오신날" },
    { date: "2026-05-25", name: "대체공휴일" },
    { date: "2026-06-06", name: "현충일" },
    { date: "2026-08-15", name: "광복절" },
    { date: "2026-08-17", name: "대체공휴일" },
    { date: "2026-09-24", name: "추석 연휴" },
    { date: "2026-09-25", name: "추석" },
    { date: "2026-09-26", name: "추석 연휴" },
    { date: "2026-10-03", name: "개천절" },
    { date: "2026-10-05", name: "대체공휴일" },
    { date: "2026-10-09", name: "한글날" },
    { date: "2026-12-25", name: "성탄절" },
  ],
  2027: [
    { date: "2027-01-01", name: "신정" },
    { date: "2027-02-06", name: "설날 연휴" },
    { date: "2027-02-07", name: "설날" },
    { date: "2027-02-08", name: "설날 연휴" },
    { date: "2027-02-09", name: "대체공휴일" },
    { date: "2027-03-01", name: "삼일절" },
    { date: "2027-05-05", name: "어린이날" },
    { date: "2027-05-13", name: "부처님오신날" },
    { date: "2027-06-06", name: "현충일" },
    { date: "2027-06-07", name: "대체공휴일" },
    { date: "2027-08-15", name: "광복절" },
    { date: "2027-08-16", name: "대체공휴일" },
    { date: "2027-09-14", name: "추석 연휴" },
    { date: "2027-09-15", name: "추석" },
    { date: "2027-09-16", name: "추석 연휴" },
    { date: "2027-10-03", name: "개천절" },
    { date: "2027-10-04", name: "대체공휴일" },
    { date: "2027-10-09", name: "한글날" },
    { date: "2027-12-25", name: "성탄절" },
  ],
  2028: [
    { date: "2028-01-01", name: "신정" },
    { date: "2028-01-25", name: "설날 연휴" },
    { date: "2028-01-26", name: "설날" },
    { date: "2028-01-27", name: "설날 연휴" },
    { date: "2028-03-01", name: "삼일절" },
    { date: "2028-05-02", name: "부처님오신날" },
    { date: "2028-05-05", name: "어린이날" },
    { date: "2028-06-06", name: "현충일" },
    { date: "2028-08-15", name: "광복절" },
    { date: "2028-10-02", name: "추석 연휴" },
    { date: "2028-10-03", name: "추석·개천절" },
    { date: "2028-10-04", name: "추석 연휴" },
    { date: "2028-10-09", name: "한글날" },
    { date: "2028-12-25", name: "성탄절" },
  ],
  2029: [
    { date: "2029-01-01", name: "신정" },
    { date: "2029-02-12", name: "설날 연휴" },
    { date: "2029-02-13", name: "설날" },
    { date: "2029-02-14", name: "설날 연휴" },
    { date: "2029-03-01", name: "삼일절" },
    { date: "2029-05-05", name: "어린이날" },
    { date: "2029-05-20", name: "부처님오신날" },
    { date: "2029-05-21", name: "대체공휴일" },
    { date: "2029-06-06", name: "현충일" },
    { date: "2029-08-15", name: "광복절" },
    { date: "2029-09-21", name: "추석 연휴" },
    { date: "2029-09-22", name: "추석" },
    { date: "2029-09-23", name: "추석 연휴" },
    { date: "2029-09-24", name: "대체공휴일" },
    { date: "2029-10-03", name: "개천절" },
    { date: "2029-10-09", name: "한글날" },
    { date: "2029-12-25", name: "성탄절" },
  ],
  2030: [
    { date: "2030-01-01", name: "신정" },
    { date: "2030-02-02", name: "설날 연휴" },
    { date: "2030-02-03", name: "설날" },
    { date: "2030-02-04", name: "설날 연휴" },
    { date: "2030-03-01", name: "삼일절" },
    { date: "2030-05-05", name: "어린이날" },
    { date: "2030-05-06", name: "대체공휴일" },
    { date: "2030-05-09", name: "부처님오신날" },
    { date: "2030-06-06", name: "현충일" },
    { date: "2030-08-15", name: "광복절" },
    { date: "2030-09-11", name: "추석 연휴" },
    { date: "2030-09-12", name: "추석" },
    { date: "2030-09-13", name: "추석 연휴" },
    { date: "2030-10-03", name: "개천절" },
    { date: "2030-10-09", name: "한글날" },
    { date: "2030-12-25", name: "성탄절" },
  ],
};

/** 해당 연도 공휴일(이름 포함). 없으면 빈 배열. */
export function koreanHolidaysForYear(year: number): Holiday[] {
  return KOREAN_HOLIDAYS[year] ?? [];
}

/** start~end가 걸치는 모든 연도의 공휴일 "날짜"만(차시 계산용 — countSessions에 넘김). */
export function koreanHolidayDatesForRange(startIso: string, endIso: string): string[] {
  const ys = Number(startIso.slice(0, 4));
  const ye = Number(endIso.slice(0, 4));
  const lo = Number.isFinite(ys) ? ys : ye;
  const hi = Number.isFinite(ye) ? ye : ys;
  if (!lo || !hi || hi < lo) return koreanHolidaysForYear(lo || hi).map((h) => h.date);
  const out: string[] = [];
  for (let y = lo; y <= hi; y++) out.push(...koreanHolidaysForYear(y).map((h) => h.date));
  return out;
}

// 날짜→이름 역색인(전 연도). 미등록 날짜는 "공휴일" 폴백.
const NAME_BY_DATE: Record<string, string> = Object.fromEntries(
  Object.values(KOREAN_HOLIDAYS).flatMap((list) => list.map((h) => [h.date, h.name])),
);

/** "YYYY-MM-DD" → 공휴일 이름(미등록 시 "공휴일"). */
export function holidayName(dateIso: string): string {
  return NAME_BY_DATE[dateIso] ?? "공휴일";
}
