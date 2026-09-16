/**
 * 교재목록 DTO — 서버·클라 공용이라 **`server-only` 금지**([[#61]]).
 * 표 모양은 0266a가 정본이고, 여기는 화면이 쓰는 카멜케이스 거울이다.
 */
import type { LessonPace, SlotAxis } from "./lesson-schedule";

export type { LessonPace, SlotAxis };

/** 조회 3-상태 — 0266a 미적용(missing-table)과 그냥 실패(failed)는 **다른 사실**이라 뭉치지 않는다. */
export type TextbookTableStatus = "ok" | "missing-table" | "failed";

export type TextbookRow = {
  id: string;
  subject: string;
  /** 구분 = 학원설정 `subjects[].skillAreas[].key`. null = 미지정(배정 불가). */
  skillArea: string | null;
  title: string;
  /** 페이지/시간 — ECS 계획 줄의 `page_range`와 같은 칸에 들어간다. */
  pageTime: string | null;
  sessionCount: number;
  coverPath: string | null;
  isActive: boolean;
  updatedAt: string;
};

/** 목록 한 줄 — 표지 서명 URL과 파생 수치를 얹은 모양. */
export type TextbookListItem = TextbookRow & {
  /** 서명된 표지 이미지 주소(없거나 서명 실패면 null — 목록은 그대로 뜬다). */
  coverUrl: string | null;
  /**
   * 진도·과제가 하나라도 적힌 차수 수(작성 정도 표시용).
   * 🔴 조회 실패면 **null**이다 — 0으로 뭉치면 "하나도 안 적었다"는 거짓말이 되고 그걸 보고 다시 적는다.
   */
  filledLessons: number | null;
  /** 이 교재를 태우고 있는 활성 배정 수. 조회 실패면 null(위와 같은 이유). */
  planCount: number | null;
};

export type TextbookLessonRow = {
  lessonNo: number;
  progress: string | null;
  homework: string | null;
};

export type TextbookDetail = {
  textbook: TextbookRow;
  coverUrl: string | null;
  lessons: TextbookLessonRow[];
};

export type ClassTextbookPlanRow = {
  id: string;
  classId: string;
  className: string;
  textbookId: string;
  textbookTitle: string;
  skillArea: string | null;
  sessionCount: number;
  slotAxis: SlotAxis;
  pace: LessonPace;
  termMode: "regular" | "exam";
  startDate: string;
  startLessonNo: number;
  isActive: boolean;
  lastAppliedAt: string | null;
};

/** 미리보기 한 줄 — 차수 하나가 어느 칸에 어떻게 들어갈지. */
export type ApplyPreviewRow = {
  lessonNo: number;
  date: string;
  slotStart: string;
  /** 교시 라벨(`8교시` 등). 없으면 null — 지어내지 않는다. */
  periodLabel: string | null;
  progress: string | null;
  homework: string | null;
  /**
   * 이 칸이 어떻게 처리될지.
   * · `add` = 새 줄이 선다 · `fill` = 이미 있는 줄의 빈 칸을 채운다
   * · `skip-filled` = 이미 다 적혀 있어 손대지 않는다(덮어쓰기 없음)
   * · `skip-empty-lesson` = 그 차수에 진도·과제가 없어 기입하지 않는다
   * · `skip-full` = 그 교시가 이미 20줄이라 새 줄을 못 세운다
   * · `skip-past` = 이미 지난 날짜라 기입하지 않는다(차수 번호는 밀지 않는다)
   */
  outcome: "add" | "fill" | "skip-filled" | "skip-empty-lesson" | "skip-full" | "skip-past";
};

export type ApplyPreview = {
  planId: string;
  className: string;
  textbookTitle: string;
  rows: ApplyPreviewRow[];
  /** 자리가 모자라 못 앉힌 차수 번호. */
  unplaced: number[];
  /** 휴일이라 건너뛴 수업일. */
  skippedHolidays: { date: string; name: string }[];
};

export type ApplyResult = {
  applied: number;
  filled: number;
  added: number;
  skipped: number;
  truncated: number;
};
