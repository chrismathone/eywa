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
  /**
   * 고른 교시(`"mon|17:20"`, 0268a). null = 옛 배정(축으로 읽는다) 또는 0268a 미적용.
   */
  slotPicks: string[] | null;
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
  /** 그 칸에 든 마지막 차수 — 25분 단위로 여러 차수가 한 칸에 들면 `lessonNo`보다 크다. */
  lessonNoEnd: number;
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
   * · `skip-full` = 그 교시가 이미 20줄이라 새 줄을 못 세운다
   * · `skip-past` = 이미 지난 날짜라 기입하지 않는다(차수 번호는 밀지 않는다)
   */
  outcome: "add" | "fill" | "skip-filled" | "skip-full" | "skip-past";
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
  /**
   * 배정으로 **계획에 선** 칸 수(원장 2026-09-22). 실제에 쓴 칸이 아니다 — 실제는 강사가
   * [가져오기]를 누를 때만 채워진다. 그래서 위 넷(applied/filled/added/skipped)과 **다른 축**이고,
   * 배정 저장 응답에서는 그 넷이 전부 0이다.
   */
  planned?: number;
};

/** 배정 다이얼로그가 고르는 교시 한 칸 — 그 반이 실제로 도는 시각. */
export type ClassSlotChoice = {
  /**
   * 이 칩을 가리키는 키 — 화면의 선택 상태이자 저장 값의 재료.
   * 🔴 **같은 시각이라도 담당이 다르면 다른 칩**이다(원장 2026-09-18) — 아래 `teacherLabel` 참조.
   */
  key: string;
  /** `"HH:MM"` — 계획 줄 `slot_start`와 같은 표기. */
  start: string;
  /** 교시 라벨(`8교시`). 없으면 null — 지어내지 않는다. */
  periodLabel: string | null;
  /** 자리면 그 이름(JJ), 강사 수업이면 null. */
  seat: "JJ" | null;
  /**
   * 표시용 담당 문자열(시간표와 같은 값). 권한 근거로 쓰지 말 것.
   * 🔑 이 값이 **칩을 가르는 축**이다 — 담당이 갈리는 날은 다른 칩으로 선다.
   */
  teacherLabel: string | null;
  /** 이 칩이 도는 요일(mon…sun) — "월·목" 처럼 보여 주고, 기입 대상도 이 요일들뿐이다. */
  dows: string[];
  /** 기입에 넘길 값 — 요일마다 `"mon|17:20"`(= `slotPickKey`). */
  picks: string[];
};
