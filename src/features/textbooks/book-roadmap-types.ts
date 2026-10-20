/** 교재 로드맵 타입 — 계산은 book-roadmap.ts. */
import type { ExamPeriod } from "./exam-periods";
import type { PlacedBook } from "./roadmap-calendar";

export type BookOrder = { bookName: string; date: string };
export type RoadBook = PlacedBook;
export type ScheduleBook = {
  key: string;
  title: string;
  startDate: string;
  finishDate: string;
  lessonCount: number;
  window: number;
  /** 마감에 걸린 권이면 마감까지 나갈 차시(계획). */
  byDeadline: number | null;
  /** 차시별 소단원(마우스 오버). 교재목록 미등록이면 빈 배열. */
  lessonUnits: string[][];
};
export type RoadmapStatus = "not-started" | "no-data" | "behind" | "on" | "ahead" | "done";
export type RoadPosition = { key: string; title: string; lessonNo: number; total: number; date: string; unit: string };

export type BookRoadmap = {
  series: string;
  /** 시작 권 ~ 목표 권. */
  books: RoadBook[];
  /** 고를 수 있는 목표 권(시작 권부터 자동 목표 몇 권 뒤까지) — 예상 완료일과 함께. */
  choices: { key: string; title: string; finishDate: string }[];
  /**
   * 교재 일정 — 시작 권부터 **마감(중3 11월 말)까지 나가는 권 전부**(원장 2026-10-20 *"27년 11월 말까지 나가는 교재는
   * 쭉 뽑아야함"*). 마감에 걸린 권도 넣고 `byDeadline`(마감까지 나갈 차시)을 붙인다. 목표를 마감 뒤로 고르면 목표까지.
   */
  schedule: ScheduleBook[];
  /** 일정 띠의 끝 — 마감과 목표 완료일 중 늦은 날. */
  scheduleEnd: string;
  target: { key: string; auto: boolean; autoKey: string };
  /** 중3 11월 말 — 자동 목표를 정한 마감. 고등·학년 미상·마감으로 못 정했으면 null. */
  deadline: string | null;
  /** 마감(중3 11월 말)이 있지만 이미 지나 지금 창 끝으로 정했다. */
  deadlinePassed: boolean;
  /** 앞서 나가 다음 권으로 넘어가서 오늘부터 일정을 다시 폈다(오늘 계획 = 실제). */
  rebased: boolean;
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
  /**
   * 나간 차시(`done`)를 계획이 끝냈어야 할 **날짜** — 날짜 눈금 레일에 실제 위치를 찍는 자리(원장 2026-10-20
   * *"교재일정이 어쨌든 전체 목표와 동일하자나 … 하나의 막대그래프에 같이"*). 오늘 계획 = 오늘 날짜라, 이 날과 오늘
   * 사이가 곧 밀린(앞선) 만큼이다. 진도를 모르면 null.
   */
  doneDate: string | null;
};

