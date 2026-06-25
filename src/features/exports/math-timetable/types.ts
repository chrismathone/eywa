/**
 * ijw 수학 시간표 익스포터 입력 계약 타입 — D:\ijw-calander\types\{timetable,student}.ts 발췌.
 * eywa 어댑터(assemble.ts)가 이 모양으로 Supabase 데이터를 변환해 exporter.ts에 넘긴다.
 */

/** studentList 항목 — 익스포터가 상태/날짜/등원요일을 직접 읽는다(셀 분류·색·정렬). */
export interface TimetableStudent {
  id?: string;
  name: string;
  school?: string | null;
  grade?: string | null;
  attendanceDays?: string[]; // Korean ["월","목"] — 비면 전 요일
  onHold?: boolean;
  withdrawalDate?: string; // 퇴원일 (YYYY-MM-DD)
  isTransferred?: boolean; // 반이동 종료(퇴원 섹션 제외)
  isTransferredIn?: boolean;
  enrollmentDate?: string; // 신입 30/60일 색·정렬
  firstSubjectEnrollmentDate?: string;
  underline?: boolean;
}

export interface TimetableClass {
  id: string;
  className: string; // 수업명
  teacher: string; // 담당 강사
  room?: string; // 교실
  subject: string; // 과목
  schedule: string[]; // ["월 1-1", "목 1-2", ...]
  studentList?: TimetableStudent[];
  studentIds?: string[];
  color?: string;
  order?: number;
  slotTeachers?: Record<string, string>; // 교시별 담당강사 (key: "월-1", value: 강사명)
  slotRooms?: Record<string, string>; // 교시별 강의실 (key: "월-1", value: 강의실)
  bgColor?: string;
  textColor?: string;
}

export interface Teacher {
  id: string;
  name: string;
  englishName?: string;
  subjects?: string[];
  isHidden?: boolean;
  color?: string;
  bgColor?: string; // 퍼스널 배경색
  textColor?: string; // 퍼스널 글자색
  order?: number;
  defaultRoom?: string;
}

/** 익스포터가 studentMap 값으로 읽는 학생 필드(상태/날짜 판정용). */
export interface UnifiedStudent {
  id: string;
  name: string;
  school?: string | null;
  grade?: string | null;
  englishName?: string | null;
  isTransferredIn?: boolean; // 반이동 입학(초록)
  enrollmentDate?: string; // 수강 시작일 (YYYY-MM-DD) — 신입 판정
  firstSubjectEnrollmentDate?: string; // 이 과목 첫 등록일
  withdrawalDate?: string; // 퇴원일 (YYYY-MM-DD)
  isTransferred?: boolean; // 반이동으로 종료 → 퇴원 섹션 제외
  onHold?: boolean; // 대기생
  underline?: boolean;
  attendanceDays?: string[]; // 등원 요일 ["월","목"] — 비면 전 요일
}
