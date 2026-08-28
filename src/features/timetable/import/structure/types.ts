// 강사별 그리드 시트(구글 스프레드시트) → class_schedules 구조 import의 타입.
// 기존 enrollment import(../types.ts)는 학생 이동만 다룬다. 이쪽은 "배치 구조"(수업/요일/시각/방/강사)를
// 시트 그리드에서 파싱한다. 파서(parse-grid.ts)는 순수함수라 이 타입만 의존(Sheets/DB 비의존).

import type { DayOfWeek } from "@/features/timetable/lib/periods";
import type { ScheduleConflict } from "./conflicts";

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
  /**
   * [row][col] 0-based, 셀에 **배경색이 칠해져 있는지**. 원장 확인(2026-08-04): 마스터 시트에서
   * **"색 없는 건 다 수업이 아님"** — 색칠된 칸만 수업이고 흰 칸은 전부 메모(`<-`·`5.5`·`김동근 4:00-4:20`·
   * 근무 인원수·`TEVO` 등)다. 이름만으로는 메모와 신설 반을 구분할 수 없어(둘 다 "DB에 없는 이름") 색이
   * 유일한 구조적 신호다. 실측(8월 탭): 색 319슬롯 전부 반 · 무색 33슬롯 전부 메모 · **섞인 이름 0**.
   *
   * ⚠️ **선택 필드**다 — 없으면(=eywa export 시트 경로·테스트 픽스처) 색 판정을 **건너뛴다**(기존 동작 유지).
   *   eywa가 생성하는 시트엔 메모가 없어 색 규칙이 필요 없다.
   */
  fills?: boolean[][];
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

/**
 * 강사 시간표의 **비수업 블록**(감독·준비·회의·연차·쉬는 시간) — 반이 아니다(0138a).
 * 시트 강사별 탭은 강사의 하루 전체를 그려서 수업 칸 사이에 이런 칸이 섞여 있다. 예전엔 "반으로 매칭
 * 안 되는 이름"으로 버려졌고, 그래서 감독이 15칸인 Dom의 시간표가 텅 비어 보였다(2026-07-22).
 */
export type ScheduleBlockKind = "supervise" | "prep" | "break" | "meeting" | "leave" | "other";

export interface ParsedScheduleBlock {
  teacherName: string; // 이 블록이 그려질 강사 레인(= 시트 블록 강사)
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  kind: ScheduleBlockKind;
  /** 화면에 그대로 찍을 시트 원문("JJ"·"쉬는 시간") — 정규화 금지(시트와 같아 보이는 게 목적). */
  label: string;
  /** kind==="supervise"일 때 감독 대상 강사명(셀 원문이 그 강사 이름 한 단어). */
  superviseTarget?: string;
}

export interface ParsedStructure {
  tabName?: string;
  teachers: ParsedTeacherBlock[];
  slots: ParsedStructureSlot[];
  /** 수업이 아닌 칸 — 강사뷰 렌더 전용. slots와 상호배타(같은 칸이 양쪽에 들어가지 않는다). */
  blocks: ParsedScheduleBlock[];
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
  /** 매칭 모호성 해소용 역할 필터(teacher/manager/master 우선). 미지정이면 필터 미적용. */
  systemRole?: string;
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

/** 기존 DB의 class_schedules 스냅샷(diff 대상 + apply temporal 마감에 필요한 필드 전부). */
export interface ExistingSchedule {
  id: string;
  classId: string;
  className: string; // 반명(remove 항목 표시·conflict용, 서버가 classes 조인해 채움)
  day: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string | null;
  teacherId: string | null;
  classroomId: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
  mergeGroup: string | null; // 합반 — keep/update 시 보존
  validFrom: string; // "YYYY-MM-DD"
  validTo: string | null;
}

export type ScheduleAction = "create" | "update" | "keep" | "remove";
export interface SchedulePlanItem {
  action: ScheduleAction;
  classId: string | null; // 시트 반명 매칭 결과(null=신규 반, apply 제외)
  className: string;
  day: DayOfWeek;
  startTime: string;
  endTime: string | null;
  room: string | null;
  teacherNames: string[];
  scheduleId?: string; // update/keep/remove 대상 기존 행 id
  /** create/update: 새 class_schedules 행에 넣을 해석된 강사 id(첫 강사=담임 후보, 미해석=null). */
  teacherId?: string | null;
  /** create/update: 새 class_schedules 행에 넣을 해석된 강의실 id(미해석=null → 라벨-only). */
  classroomId?: string | null;
  /** update일 때 변경 전 값(화면 "이전→이후" 표시용). */
  before?: { endTime: string | null; room: string | null; teacherNames: string[] };
}

/** classes 담임/기본강의실 갱신 계획 1건(apply payload) — teacherId/classroomId=null이면 그 필드 미변경. */
export interface ApplyClassUpdate {
  classId: string;
  teacherId: string | null;
  classroomId: string | null;
  prevTeacherId: string | null; // 롤백 복원용
  prevClassroomId: string | null;
}

export interface DryRunReport {
  slotsParsed: number;
  targetSchedules: number;
  entitiesToCreate: { teachers: string[]; classes: string[]; rooms: string[] };
  matched: { classes: number; teachers: number; rooms: number };
  plan: { create: number; update: number; keep: number; remove: number };
  planItems: SchedulePlanItem[];
  /**
   * 적용 후 배치의 물리적 충돌([`conflicts.ts`](./conflicts.ts)) — 한 방에 두 반·한 강사가 두 방·한 반이
   * 두 줄·합반 의심. 합반만 경고이고 나머지는 **확인 체크 없이는 적용을 막는다**(원장 2026-08-28).
   */
  conflicts: ScheduleConflict[];
  warnings: string[];
  /** 계획(변경분)의 결정적 해시 — Phase 2 apply가 서버 재계산 결과와 대조해 스테일/조작 차단. */
  hash: string;
}
