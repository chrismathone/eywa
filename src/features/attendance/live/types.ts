/**
 * 당일 출결 화면이 주고받는 타입 — **일반 모듈**(`server-only` 없음).
 *
 * ⚠️ 클라이언트 컴포넌트가 이 타입들을 쓴다. 정의를 `server/*.ts`(= `import "server-only"`)에 두면
 *    지금은 `import type`이라 지워지지만, 나중에 누가 값 하나를 같이 가져오는 순간 런타임 상수가
 *    클라 번들로 새어 빌드가 깨진다(gotcha #61). 그래서 모양은 여기, 조회는 저기로 갈라 둔다.
 */

import type { LiveSignal, SlotPhase } from "./signals";

export type LiveStudent = {
  studentId: string;
  studentName: string;
  schoolGrade: string | null;
  parentPhone: string | null;
  studentPhone: string | null;
  /** 그 (학생·반·날짜·교시)의 유효 출결(없으면 null). */
  status: string | null;
  /**
   * 그 칸을 채운 기록의 교시. null = 그날 전체 행이거나 기록 없음.
   * 좌석표가 학생축으로 접을 때 "이미 있는 행을 갱신"하려면 이 값이 필요하다.
   */
  recordSlot?: string | null;
  /** 그 기록의 recorded_at — 같은 날 여러 교시가 있으면 최신 우선. */
  recordedAt?: string | null;
  /**
   * 강사가 남긴 사유 메모. 🔴 데스크가 전화 **전에** 봐야 하는 값이다 — "감기로 결석"이라고 이미 적혀
   * 있는데 집에 또 전화하면 학부모는 학원이 소통이 안 된다고 느낀다. 보강 연결(`linkMakeupToAbsence`)도
   * 이 메모에 흔적을 남기므로, 보강 갈 아이를 결석으로 오인해 전화하는 것도 여기서 걸린다.
   */
  note: string | null;
  /** null = 강사가 이미 답한 칸(확인할 게 없다). */
  signal: LiveSignal | null;
};

export type LiveSlot = {
  /** `${classId}@${slotStart}` — 화면 키이자 후속조치 앵커. */
  key: string;
  classId: string;
  className: string;
  subject: string;
  slotStart: string; // "HH:MM" — 화면 표시·큐 앵커
  /**
   * **저장에 실을 교시 값**(`slot-axis.ts`) — per-slot 과목(영어)만 값이 있고 나머지는 `null`.
   * 🔴 화면 축(`slotStart`)과 저장 축을 반드시 구분할 것. 수학은 하루 한 행이 규약이라 교시를 실으면
   *    연강 반의 시수·회차가 2~3배가 된다(실측: 오늘 수학 19반 중 17반이 2~3교시).
   */
  saveSlot: string | null;
  slotEnd: string | null;
  periodLabel: string | null;
  teacherId: string | null;
  teacherName: string | null;
  /**
   * 슬롯에 적힌 담당 표기(LAB·JJ 등) — 자리 반은 **사람이 아니라 자리**라 `teacher_id`가 비어 있다
   * (실측: 살아 있는 무담당 슬롯 20개 중 LAB 9·JJ 3). 이게 없으면 데스크 화면에서 전부 "담당 미지정"으로
   * 뭉쳐 누구에게 전화할지 알 수 없다.
   */
  slotTeacherLabel: string | null;
  /**
   * 그 교시의 강의실 이름(슬롯 FK → 슬롯 라벨 → 반 기본).
   * 좌석표가 층·호로 묶는 근거. 없으면 null(「강의실 미지정」).
   */
  roomName: string | null;
  students: LiveStudent[];
  /** 그 (반,교시)에 출결 기록이 하나라도 있는가 — 레인 A/B를 가르는 근거. */
  hasAnyRecord: boolean;
  recordedCount: number;
};

export type LiveBoardSlot = LiveSlot & {
  phase: SlotPhase;
  /**
   * 이 슬롯이 **내 수업**인가(담임·부담임·위임).
   * 데스크(전 학원 쓰기)라도 자기 반은 강사 규칙(10분 전에도 찍음)을 쓰고,
   * 남의 반은 데스크 규칙(10분 후 미출결만)을 쓴다.
   */
  ownedByMe: boolean;
};

export type LiveBoard = {
  date: string;
  isToday: boolean;
  /** 강사별 묶음 — "선생님별 출석부"의 축(원장 표현 그대로). */
  teachers: {
    teacherId: string | null;
    teacherName: string;
    teacherPhone: string | null;
    slots: LiveBoardSlot[];
    expected: number;
    recorded: number;
  }[];
  /** 내 시점인가(강사) — 화면이 "내 수업"이라 말할지 "전체"라 말할지. */
  scopedToSelf: boolean;
  canEdit: boolean;
  totals: { expected: number; recorded: number; slots: number };
};
