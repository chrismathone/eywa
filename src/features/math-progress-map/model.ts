/**
 * 수학 학습 진도맵 — **데이터 모델**(순수 타입, 화면·서버 공용).
 *
 * 화면은 이 모양 하나만 읽는다. 지금은 샘플([`sample.ts`](./sample.ts))이 채우고, 실데이터 배선은
 * `lesson_reports`(원스크린 수학 보고서)·`math_month_goals`(MCS 월간 목표)를 이 모양으로 접는 서버
 * 어댑터 하나를 더하면 된다 — 화면 컴포넌트는 손대지 않는다.
 *
 * 🔑 단위는 **쪽(page)** 하나다 — 일·주·월·분기·연간 요약이 전부 같은 단위로 세어야 "확대/축소"가
 *    성립한다(단원 수·문제 수를 섞으면 줄마다 다른 것을 센다).
 * 🔴 상태 4종은 **저장된 사실**이고 "예정/미학습"은 날짜가 가른다(`not-started`가 기준일 뒤면 예정,
 *    앞이면 미학습) — 화면이 스스로 상태를 지어내지 않는다.
 */

export type ProgressStatus = "completed" | "in-progress" | "not-started" | "no-plan";

/** 하루치 학습 기록(또는 계획). */
export interface DailyProgress {
  /** YYYY-MM-DD */
  date: string;
  bookName: string;
  /** 대단원 — "Ⅲ. 일차함수" */
  chapter: string;
  /** 소단원 — "일차함수의 뜻" (주간 요약이 이 이름을 쓴다) */
  subChapter: string;
  /** 계획 쪽 범위. 새 쪽이 없는 날(오답정리 등)은 0·0. */
  startPage: number;
  endPage: number;
  /** 끝낸 마지막 쪽(계획 범위 안). 시작 전이면 startPage - 1. */
  completedPage: number;
  status: ProgressStatus;
  /** 짧은 메모 — "오답정리"·"휴강(추석)" */
  note?: string;
}

/** 한 달 계획 — 연간 링 한 칸. */
export interface MonthPlan {
  /** 1~12 */
  month: number;
  bookName: string;
  /** 학기 표기 — "중1-2" (커리큘럼 위치 축) */
  semester: string;
  /** 그 달의 대단원 — 둘이면 " / "로 잇는다 */
  chapter: string;
  startPage: number;
  endPage: number;
}

/** 교재 안 대단원 범위 — 쪽 → 대단원 이름(계획 위치 표기)에 쓴다. */
export interface BookChapter {
  title: string;
  fromPage: number;
  toPage: number;
}

/** 커리큘럼 사다리 한 칸(학기 축). */
export interface CurriculumStep {
  id: string;
  /** "중1-2" */
  label: string;
  /** 어느 달에 걸치는가(연간 계획에서 도출해도 되지만 사다리는 미래 학기까지 적는다) */
  months: number[];
}

/** 입학~종강 장기 계획. YYYY-MM을 써서 다른 연도의 같은 달이 섞이지 않게 한다. */
export interface RoadmapStep {
  id: string;
  label: string;
  group: string;
  startMonth: string;
  endMonth: string;
  estimated: boolean;
  description: string;
}

export interface ProgressYear {
  year: number;
  yearPlan: MonthPlan[];
  dailyProgress: DailyProgress[];
  estimated?: boolean;
  calendar?: ProgressCalendar;
}

/** 학생의 수업 일정. 공휴일 색 표시와 실제 수업 유무는 별개다. */
export interface ProgressCalendar {
  /** 0=일 ~ 6=토. 미설정이면 기록 없는 날을 비수업일로 추정하지 않는다. */
  classWeekdays?: number[];
  /** 날짜 → 휴강 사유. 실데이터는 학원설정 휴원일과 학생별 휴강 일정을 접어 전달한다. */
  daysOff?: Record<string, string>;
}

export interface LearningRoadmap {
  enrolledOn: string;
  targetLabel: string;
  estimateNote: string;
  steps: RoadmapStep[];
}

export interface StudentProgress {
  studentId: string;
  studentName: string;
  /** "중1" — 학원설정 학년 라벨 그대로 */
  grade: string;
  /** 기준일(YYYY-MM-DD) — 샘플은 고정, 실데이터는 KST 오늘 */
  asOf: string;
  /** 연간 링이 그리는 해 */
  year: number;

  curriculum: {
    bookId: string;
    bookName: string;
    semester: string;
    chapter: string;
    subChapter: string;
    currentPage: number;
    totalPages: number;
    chapters: BookChapter[];
  };

  /** 교재 단위 계획 — 선형 속도로 "오늘 있어야 할 쪽"을 낸다. */
  plan: {
    startDate: string;
    targetDate: string;
    startPage: number;
    targetPage: number;
  };

  yearPlan: MonthPlan[];
  curriculumPath: CurriculumStep[];
  currentStepId: string;
  dailyProgress: DailyProgress[];
  /** 다른 연도의 기록·계획. 현재 year의 데이터는 위 필드를 사용한다. */
  years?: ProgressYear[];
  roadmap?: LearningRoadmap;
  estimated?: boolean;
  calendar?: ProgressCalendar;
}

/** 화면 보기 단위 — 하나의 데이터셋을 이 단위로 확대/축소한다. */
export type ViewMode = "day" | "week" | "month" | "quarter" | "year";

export const VIEW_MODES: readonly ViewMode[] = ["day", "week", "month", "quarter", "year"];

export const VIEW_MODE_LABEL: Record<ViewMode, string> = {
  day: "일간",
  week: "주간",
  month: "월간",
  quarter: "분기",
  year: "연간",
};

/** 계획 대비 판정 — 원장 지시 임계값: +7일 이상 빠름 · −6~+6 계획대로 · −7일 이하 느림. */
export type PaceStatus = "ahead" | "normal" | "delayed";

export interface PlanVsActual {
  /** 오늘 계획상 있어야 할 쪽 */
  plannedPage: number;
  /** 계획 위치의 대단원 */
  plannedChapter: string;
  actualPage: number;
  actualChapter: string;
  /** 하루 계획 쪽수(선형) */
  pagesPerDay: number;
  /** 양수 = 빠름(일). 계획 속도로 환산한 값. */
  differenceDays: number;
  status: PaceStatus;
}
