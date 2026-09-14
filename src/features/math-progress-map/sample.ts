/**
 * 진도맵 **샘플 데이터** — 김민준(중1), 기준일 2026-09-16. 화면 확인용이며 DB·학원설정을 읽지 않는다.
 *
 * 🔴 실데이터가 아니다 — 학생 이름·교재·쪽수·휴일 전부 지어낸 값이다(원장 시안 확인용). 실데이터 배선은
 *    `lesson_reports`·`math_month_goals`를 `StudentProgress`로 접는 서버 어댑터로 하고, 이 파일은 그때 시안
 *    스토리·테스트 픽스처로만 남긴다. 휴일 목록도 여기 것은 샘플 전용이다(앱은 학원설정 `operations.holidays`가
 *    단일 소스).
 *
 * 생성 규칙: 수업일 = 월~금(휴일 제외), 달 계획 쪽수를 수업일에 고르게 나눈다. 기준일 앞은 완료, 뒤는 예정.
 * 9월만 손으로 적었다(3주차가 지시서의 예시 — 9/14 p.42~47 · 9/15 p.48~53 · 9/16 p.54~59 진행 중 · 9/17 예정 · 9/18 오답정리).
 */
import { daysInMonth, weekdayOf, ymd } from "./calendar";
import type { BookChapter, DailyProgress, MonthPlan, StudentProgress } from "./model";

export const SAMPLE_YEAR = 2026;
export const SAMPLE_AS_OF = "2026-09-16";

const HOLIDAYS: Record<string, string> = {
  "2026-01-01": "신정",
  "2026-02-16": "설날",
  "2026-02-17": "설날",
  "2026-02-18": "설날",
  "2026-03-02": "삼일절 대체휴일",
  "2026-05-05": "어린이날",
  "2026-05-25": "부처님오신날 대체휴일",
  "2026-08-17": "광복절 대체휴일",
  "2026-09-24": "추석",
  "2026-09-25": "추석",
  "2026-10-05": "개천절 대체휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
};

type SampleMonth = MonthPlan & { topics: string[] };

const YEAR_PLAN: SampleMonth[] = [
  { month: 1, bookName: "GA 초6-2", semester: "초6-2", chapter: "Ⅳ. 비례식과 비례배분", startPage: 97, endPage: 150, topics: ["비의 성질", "비례식", "비례배분"] },
  { month: 2, bookName: "GA 초6-2", semester: "초6-2", chapter: "Ⅴ. 원의 넓이 / Ⅵ. 원기둥·원뿔·구", startPage: 151, endPage: 210, topics: ["원주율", "원의 넓이", "원기둥과 원뿔"] },
  { month: 3, bookName: "GA 중1-1", semester: "중1-1", chapter: "Ⅰ. 소인수분해", startPage: 1, endPage: 48, topics: ["소수와 합성수", "소인수분해", "최대공약수와 최소공배수"] },
  { month: 4, bookName: "GA 중1-1", semester: "중1-1", chapter: "Ⅱ. 정수와 유리수", startPage: 49, endPage: 110, topics: ["정수와 유리수", "정수의 덧셈과 뺄셈", "유리수의 곱셈과 나눗셈"] },
  { month: 5, bookName: "GA 중1-1", semester: "중1-1", chapter: "Ⅲ. 문자와 식", startPage: 111, endPage: 160, topics: ["문자의 사용", "일차식의 계산"] },
  { month: 6, bookName: "GA 중1-1", semester: "중1-1", chapter: "Ⅳ. 일차방정식", startPage: 161, endPage: 210, topics: ["방정식과 해", "일차방정식의 풀이", "일차방정식의 활용"] },
  { month: 7, bookName: "GA 중1-1", semester: "중1-1", chapter: "Ⅴ. 좌표평면과 그래프", startPage: 211, endPage: 260, topics: ["순서쌍과 좌표", "그래프", "정비례와 반비례"] },
  { month: 8, bookName: "GA 중1-2", semester: "중1-2", chapter: "Ⅰ. 기본도형", startPage: 1, endPage: 30, topics: ["점·선·면", "각", "위치 관계"] },
  { month: 9, bookName: "GA 중1-2", semester: "중1-2", chapter: "Ⅱ. 좌표평면과 그래프 / Ⅲ. 일차함수", startPage: 31, endPage: 98, topics: ["좌표평면", "그래프", "일차함수의 뜻과 그래프"] },
  { month: 10, bookName: "GA 중1-2", semester: "중1-2", chapter: "Ⅳ. 통계", startPage: 99, endPage: 180, topics: ["줄기와 잎 그림", "도수분포표", "상대도수"] },
  { month: 11, bookName: "GA 중2-1", semester: "중2-1", chapter: "Ⅰ. 유리수와 순환소수", startPage: 1, endPage: 54, topics: ["유한소수와 무한소수", "순환소수"] },
  { month: 12, bookName: "GA 중2-1", semester: "중2-1", chapter: "Ⅱ. 식의 계산", startPage: 55, endPage: 120, topics: ["지수법칙", "단항식의 계산", "다항식의 계산"] },
];

const BOOK_CHAPTERS: BookChapter[] = [
  { title: "Ⅰ. 기본도형", fromPage: 1, toPage: 30 },
  { title: "Ⅱ. 좌표평면과 그래프", fromPage: 31, toPage: 41 },
  { title: "Ⅲ. 일차함수", fromPage: 42, toPage: 98 },
  { title: "Ⅳ. 통계", fromPage: 99, toPage: 180 },
];

/** 9월 — 손으로 적은 달. (start, end, completed, subChapter, note) · 0쪽 = 새 쪽 없는 날. */
type Row = [date: string, start: number, end: number, completed: number, sub: string, chapter: string, note?: string];
const SEPTEMBER: Row[] = [
  ["2026-09-01", 31, 33, 33, "좌표평면", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-02", 34, 35, 35, "좌표평면", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-03", 36, 36, 36, "좌표평면", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-04", 37, 38, 38, "그래프", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-07", 39, 39, 39, "그래프", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-08", 40, 40, 40, "그래프", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-09", 41, 41, 41, "그래프", "Ⅱ. 좌표평면과 그래프"],
  ["2026-09-10", 0, 0, 0, "그래프", "Ⅱ. 좌표평면과 그래프", "단원 오답정리"],
  ["2026-09-11", 0, 0, 0, "그래프", "Ⅱ. 좌표평면과 그래프", "단원 평가"],
  ["2026-09-14", 42, 47, 47, "일차함수의 뜻", "Ⅲ. 일차함수"],
  ["2026-09-15", 48, 53, 53, "일차함수의 그래프", "Ⅲ. 일차함수"],
  ["2026-09-16", 54, 59, 57, "일차함수의 그래프", "Ⅲ. 일차함수"],
  ["2026-09-17", 60, 65, 59, "기울기와 절편", "Ⅲ. 일차함수"],
  ["2026-09-18", 66, 68, 65, "기울기와 절편", "Ⅲ. 일차함수", "오답정리"],
  ["2026-09-21", 69, 74, 68, "일차함수의 활용", "Ⅲ. 일차함수"],
  ["2026-09-22", 75, 80, 74, "일차함수의 활용", "Ⅲ. 일차함수"],
  ["2026-09-23", 81, 86, 80, "일차함수 종합", "Ⅲ. 일차함수"],
  ["2026-09-28", 87, 92, 86, "단원 마무리", "Ⅲ. 일차함수"],
  ["2026-09-29", 93, 98, 92, "단원 마무리", "Ⅲ. 일차함수"],
  ["2026-09-30", 0, 0, 0, "단원 마무리", "Ⅲ. 일차함수", "단원 평가 · 오답정리"],
];

function septemberRecords(): DailyProgress[] {
  const rows: DailyProgress[] = SEPTEMBER.map(([date, startPage, endPage, completedPage, subChapter, chapter, note]) => {
    const past = date < SAMPLE_AS_OF;
    const status = date === SAMPLE_AS_OF ? "in-progress" : past ? "completed" : "not-started";
    return { date, bookName: "GA 중1-2", chapter, subChapter, startPage, endPage, completedPage, status, note };
  });
  for (const [date, name] of Object.entries(HOLIDAYS)) {
    if (date.startsWith("2026-09") && weekdayOf(date) >= 1 && weekdayOf(date) <= 5) {
      rows.push({ date, bookName: "GA 중1-2", chapter: "Ⅲ. 일차함수", subChapter: "", startPage: 0, endPage: 0, completedPage: 0, status: "no-plan", note: `휴강(${name})` });
    }
  }
  return rows;
}

/** 나머지 달 — 수업일(월~금, 휴일 제외)에 쪽수를 고르게 나눈다. 앞 수업일부터 나머지 한 쪽씩 더. */
function generatedRecords(m: SampleMonth): DailyProgress[] {
  const dim = daysInMonth(SAMPLE_YEAR, m.month);
  const days = Array.from({ length: dim }, (_, i) => ymd(SAMPLE_YEAR, m.month, i + 1)).filter((d) => weekdayOf(d) >= 1 && weekdayOf(d) <= 5);
  const classDays = days.filter((d) => !HOLIDAYS[d]);
  const total = m.endPage - m.startPage + 1;
  const base = Math.floor(total / classDays.length);
  const extra = total - base * classDays.length;
  let page = m.startPage;
  const out: DailyProgress[] = [];
  classDays.forEach((date, i) => {
    const n = base + (i < extra ? 1 : 0);
    const startPage = page;
    const endPage = page + n - 1;
    page = endPage + 1;
    const past = date < SAMPLE_AS_OF;
    const subChapter = m.topics[Math.min(m.topics.length - 1, Math.floor((i * m.topics.length) / classDays.length))]!;
    out.push({
      date,
      bookName: m.bookName,
      chapter: m.chapter,
      subChapter,
      startPage,
      endPage,
      completedPage: past ? endPage : startPage - 1,
      status: past ? "completed" : "not-started",
    });
  });
  for (const d of days) {
    if (HOLIDAYS[d]) out.push({ date: d, bookName: m.bookName, chapter: m.chapter, subChapter: "", startPage: 0, endPage: 0, completedPage: 0, status: "no-plan", note: `휴강(${HOLIDAYS[d]})` });
  }
  return out;
}

export function buildSampleProgress(): StudentProgress {
  const dailyProgress = YEAR_PLAN.flatMap((m) => (m.month === 9 ? septemberRecords() : generatedRecords(m))).sort((a, b) => (a.date < b.date ? -1 : 1));
  const latest = [...dailyProgress].reverse().find((r) => r.date <= SAMPLE_AS_OF && r.startPage > 0)!;
  return {
    studentId: "sample-kim-minjun",
    studentName: "김민준",
    grade: "중1",
    asOf: SAMPLE_AS_OF,
    year: SAMPLE_YEAR,
    curriculum: {
      bookId: "ga-m1-2",
      bookName: "GA 중1-2",
      semester: "중1-2",
      chapter: latest.chapter,
      subChapter: latest.subChapter,
      currentPage: latest.completedPage,
      totalPages: 180,
      chapters: BOOK_CHAPTERS,
    },
    // 8/20 시작 · 12/18 목표 → 하루 약 1.5쪽. 9/16 계획 = p.41(Ⅱ. 그래프 끝) vs 실제 p.57 → 약 11일 빠름.
    plan: { startDate: "2026-08-20", targetDate: "2026-12-18", startPage: 1, targetPage: 180 },
    yearPlan: YEAR_PLAN.map(({ month, bookName, semester, chapter, startPage, endPage }) => ({ month, bookName, semester, chapter, startPage, endPage })),
    curriculumPath: [
      { id: "e6-2", label: "초6-2", months: [1, 2] },
      { id: "m1-1", label: "중1-1", months: [3, 4, 5, 6, 7] },
      { id: "m1-2", label: "중1-2", months: [8, 9, 10] },
      { id: "m2-1", label: "중2-1", months: [11, 12] },
      { id: "m2-2", label: "중2-2", months: [] },
    ],
    currentStepId: "m1-2",
    dailyProgress,
  };
}
