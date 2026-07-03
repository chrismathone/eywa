// 강사별 그리드 시트(구글 스프레드시트) → class_schedules 구조 import의 타입.
// 기존 enrollment import(../types.ts)는 학생 이동만 다룬다. 이쪽은 "배치 구조"(수업/요일/시각/방/강사)를
// 시트 그리드에서 파싱한다. 파서(parse-grid.ts)는 순수함수라 이 타입만 의존(Sheets/DB 비의존).

import type { DayOfWeek } from "@/features/timetable/lib/periods";

/**
 * Sheets `spreadsheets.get(includeGridData:true)`의 한 탭을 옮긴 격자 스냅샷.
 * - cells: [row][col] 0-based, 각 셀의 formattedValue(빈 셀은 ""). 병합셀은 좌상단에만 값이 있다.
 * - merges: 0-based, **end-exclusive**(Sheets 원형 그대로). values.get은 병합을 잃으므로 필수.
 */
export interface SheetGridMerge {
  startRowIndex: number; // 0-based inclusive
  endRowIndex: number; // 0-based exclusive
  startColumnIndex: number; // 0-based inclusive
  endColumnIndex: number; // 0-based exclusive
}
export interface SheetGrid {
  tabName?: string;
  cells: string[][];
  merges: SheetGridMerge[];
}

/** 강사별 그리드의 강사 블록 1개(가로 6열 = 월~토). */
export interface ParsedTeacherBlock {
  index: number; // 1행의 블록 번호(1..16)
  header: string; // 2행 원문 "Jane 추민아 301 (프리랜서)"
  name: string; // 선두 토큰 강사명 "Jane" (englishName 매칭 앵커)
  homeRoom: string | null; // 헤더에서 뽑은 담임 방 "301"
  note: string; // 3행 메모(근무시간 등)
  reserve: boolean; // "예비N" 빈 블록
  startColumn: number; // 0-based 블록 시작 열
}

/** 파싱된 수업 배치 1건 = 향후 class_schedules 한 행. */
export interface ParsedStructureSlot {
  teacherIndex: number;
  teacherName: string;
  teacherHeader: string;
  day: DayOfWeek; // mon..sat
  koDay: string; // 월..토
  className: string; // "중등E_중2 심화" | "LT2"
  room: string | null; // "301" | "SKY" | null(담임방 폴백 후에도 없으면)
  startTime: string; // "HH:MM" 24h
  endTime: string | null; // "HH:MM" 24h (라벨에서 끝시각 못 구하면 null)
  rawTimeLabel: string; // A열 원문 "4:20~5:00"
  starred: boolean; // 셀 선두 '*' (보강/임시 표시)
  raw: string; // 셀 원문
  /** 출처(0-based, r2/c2 inclusive) — _meta 라운드트립·디버깅용. */
  grid: { r1: number; c1: number; r2: number; c2: number };
}

export interface ParsedStructure {
  tabName?: string;
  teachers: ParsedTeacherBlock[];
  slots: ParsedStructureSlot[];
  warnings: string[];
}

// ── match: 파싱 슬롯 ↔ 기존 DB 레코드(이름 기준) ──────────────────────────────
// eywa 레코드가 구버전이라 신뢰 대상이 아니다 → 시트를 진실원본으로 두고
// "이름으로 매칭되면 그 레코드, 없으면 신규 생성 대상"으로 분류만 한다(쓰기 없음).

export interface ExistingClassRef {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  classroomId: string | null;
}
export interface ExistingTeacherRef {
  id: string;
  englishName: string | null;
  displayName: string;
}
export interface ExistingRoomRef {
  id: string;
  name: string;
}
/** 매칭에 필요한 기존 레코드 스냅샷(서버가 주입 — 순수 match는 DB 비의존). */
export interface ExistingContext {
  classes: ExistingClassRef[];
  teachers: ExistingTeacherRef[];
  classrooms: ExistingRoomRef[];
}

/** 슬롯 + 해석된 기존 ID(없으면 null = 신규 대상). */
export interface ResolvedSlot extends ParsedStructureSlot {
  classId: string | null;
  teacherId: string | null;
  classroomId: string | null;
}

export interface MatchResult {
  resolved: ResolvedSlot[];
  /** 시트엔 있으나 기존 레코드에 없어 새로 만들어야 하는 것들(중복 제거·정렬). */
  newClassNames: string[];
  newTeacherNames: string[];
  newRoomNames: string[];
  matchedClasses: number;
  matchedTeachers: number;
  matchedRooms: number;
}

// ── diff/conflict/dry-run ────────────────────────────────────────────────────

/** 시트에서 도출한 목표 class_schedules 한 행(중복 병합 후). */
export interface TargetSchedule {
  className: string;
  classId: string | null;
  day: DayOfWeek;
  startTime: string;
  endTime: string | null;
  room: string | null;
  classroomId: string | null;
  /** 이 슬롯을 가르치는 강사(합반이면 복수). 첫 강사가 담임 후보. */
  teachers: { name: string; teacherId: string | null }[];
  starred: boolean;
}

/** 기존 DB의 class_schedules 스냅샷(diff 대상). */
export interface ExistingSchedule {
  id: string;
  classId: string;
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string | null;
}

export type ScheduleAction = "create" | "update" | "keep" | "remove";
export interface SchedulePlanItem {
  action: ScheduleAction;
  className: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string | null;
  room: string | null;
  teacherNames: string[];
  scheduleId?: string; // update/keep/remove 대상 기존 행
}

/** 강의실 중복(같은 방·요일·시간 겹침 + 다른 수업/강사). */
export interface RoomConflict {
  room: string;
  day: DayOfWeek;
  a: { className: string; teachers: string[]; startTime: string; endTime: string | null };
  b: { className: string; teachers: string[]; startTime: string; endTime: string | null };
}

export interface DryRunReport {
  slotsParsed: number;
  targetSchedules: number;
  entitiesToCreate: { teachers: string[]; classes: string[]; rooms: string[] };
  matched: { classes: number; teachers: number; rooms: number };
  plan: { create: number; update: number; keep: number; remove: number };
  planItems: SchedulePlanItem[];
  conflicts: RoomConflict[];
  warnings: string[];
}
