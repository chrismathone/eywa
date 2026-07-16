/**
 * 선생님 원스크린 — 타입.
 * 프로토타입(data/원스크린_전달/data.js)의 학생 shape를 그대로 타입화.
 * 데모 충실 이식: 입력은 클라이언트 state로만 돌고 DB에 영속화하지 않는다.
 */

/** 과목 톤 — eywa 디자인 토큰(globals.css)에 매핑된 색 키 */
export type SubjectTone = "primary" | "blue" | "rose" | "purple" | "gold" | "neutral";

/** 직전 회차(이전 작성) 스냅샷 — 표뷰 '이전 회차 참고행'에 읽기전용 렌더. lesson_reports 한 행에서 추출. */
export type PrevReport = {
  date: string; // 직전 회차 날짜 YYYY-MM-DD
  progress: string | null; // 진도(과목 라벨 벗긴 텍스트, 다중차시면 개행 포함)
  textbook: string | null; // 교재명
  homeworkToday: string | null; // 오늘 과제(숙제 내용)
  homeworkScore: string | null; // 과제 수행 상태
  attitude: string | null; // 수업 태도
  examInfo: string | null; // "일일 18/20, 확인 19/20"
  note: string | null; // 학부모 멘트(notes)
};

export type Subject = {
  name: string; // "영어 독해", "수학 (상)", "국어 문학"
  prev: string; // 이전 진도 — "Unit 7 · p.82"
  today: string; // 오늘 진도 — "Unit 8 · p.90"
  // 운영 과목 키(operations.subjects) — 진도 입력 방식 분기에 사용.
  // "math"면 커리큘럼 드롭다운(curriculum.ts), 그 외(영어 등)면 freeform 텍스트.
  // 미지정(데모)이면 "math"로 간주 → 기존 커리큘럼 동작 보존.
  subjectKey?: string;

  // 교재명·보강 — 0089a(edutrix 강사 필드 패리티). 과목별. textbook=학부모 카드에도 표시, makeup=보강 수업.
  textbook?: string;
  makeup?: boolean;
  // 오늘 과제(숙제 내용) — 0096a(edutrix homework_today 패리티). 과목별. 학부모 카드 표시(showHomeworkToday)
  // + AI 멘트 마무리 문장("오늘 과제는 ~입니다")의 재료. homework(수행 상태)와 별개.
  homeworkToday?: string;

  // 직전 회차(이전 작성) 참고용 — roster가 (학생×과목)별 직전 lesson_reports를 담아 표뷰 '이전 회차 참고행'에 렌더.
  // 읽기 전용(편집 불가). 없으면(첫 수업) undefined.
  prevReport?: PrevReport;

  // 복원된 멘트/추세 초안 — roster가 오늘 세션(onescreen_daily_sessions) 우선, 없으면 오늘 발송본
  // (lesson_reports notes/trend_note)에서 채워 initReports가 reports state 초기값으로 사용(새로고침 유지).
  draft?: string;
  trendDraft?: string;

  // ── 오늘 보고서 발송 상태(과목별) — roster가 오늘 lesson_reports를 subject로 매칭해 채움 ──
  // 학생단위로 뭉개면 다과목(수학만 저장해도 영어까지 sent)이 오카운트되므로 과목별로 분리.
  reportSent?: boolean; // 오늘 이 과목 보고서가 저장됨
  shareToken?: string; // 오늘 이 과목 보고서의 /r 공유 토큰
  classnoteStatus?: string; // ClassNote 발송 상태(queued/processing/success/failed/too_old, null=미요청)
  revokedAt?: string; // 공유링크 취소 시각(P2a) — 있으면 링크 열람 차단됨
  viewCount?: number; // 학부모 열람 수(share_link_views count, P2a)
  attachments?: { path: string; name: string }[]; // 학생 사진 첨부(P2b) — /r·ClassNote 스샷에 렌더
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
  tag: string; // 필터용 태그 (실데이터=반 이름, 데모=학년)
  className?: string; // 강사 담당 반 이름 — 원스크린 좌측 반별 그룹/필터
  classId?: string;
  // 진도(수업) 학년 — 실제 학년과 다를 수 있음(선행/후행). 없으면 grade로 간주.
  studyGrade?: string;
  // 보강·수업외 학생(수동 추가) — true면 세션 자동저장(onescreen_daily_sessions) 건너뛰고(반 없음),
  // 저장 시 outOfClass로 담당반 검사 우회(같은 학원 학생이면 허용). roster엔 없고 클라에서만 추가됨.
  isMakeup?: boolean;
  attendance: AttendanceMark;
  subjects: Subject[];
  tests: Tests;
  attitude: string | null; // "아주 좋음" | "좋음" | "보통" | "산만함" | "피곤함" | null
  homework: string; // "완료" | "일부 미흡" | "미제출" | "—"
  note?: string; // 특이사항(강사 메모) — 0093a. AI 멘트 입력(공지 모드 A/B). 학부모엔 생성 문구만. 미설정=빈 메모.

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
