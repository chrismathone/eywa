/**
 * 선생님 원스크린 — 타입.
 * 프로토타입(data/원스크린_전달/data.js)의 학생 shape를 그대로 타입화.
 * 데모 충실 이식: 입력은 클라이언트 state로만 돌고 DB에 영속화하지 않는다.
 */

/** 과목 톤 — eywa 디자인 토큰(globals.css)에 매핑된 색 키 */
export type SubjectTone = "primary" | "blue" | "rose" | "purple" | "gold" | "neutral";

export type Subject = {
  name: string; // "영어 독해", "수학 (상)", "국어 문학"
  prev: string; // 이전 진도 — "Unit 7 · p.82"
  today: string; // 오늘 진도 — "Unit 8 · p.90"
};

/** 한 테스트(일일/확인)의 점수 + 만점 + 직전 회차 점수 */
export type TestScore = {
  score: number | null; // 미입력이면 null
  max: number;
  prevScore: number | null;
};

export type Tests = {
  daily: TestScore; // 일일테스트 (이전 진도 범위)
  check: TestScore; // 확인테스트 (오늘 진도 범위)
};

export type AttendanceMark = "출석" | "지각" | "결석";

export type OneScreenStudent = {
  id: string;
  name: string;
  grade: string; // 실제 학년 — "초3" ~ "중3"
  tag: string; // 필터용 학년 태그 (= grade)
  // 진도(수업) 학년 — 실제 학년과 다를 수 있음(선행/후행). 없으면 grade로 간주.
  studyGrade?: string;
  attendance: AttendanceMark;
  subjects: Subject[];
  tests: Tests;
  attitude: string | null; // "아주 좋음" | "좋음" | "보통" | "산만함" | "피곤함" | null
  homework: string; // "완료" | "일부 미흡" | "미제출" | "—"

  // ── 런타임 state (클라이언트에서만 변경, 새로고침 시 초기화) ──
  progressConfirmed: boolean;
  reportDraft: string;
  reportSent: boolean;
};

/** 학생 행의 진/테/보 상태 셀 */
export type CellState = "ok" | "warn" | "todo";

export type StudentStatus = {
  prog: CellState; // 진도
  test: CellState; // 테스트
  rep: CellState; // 보고서
};
