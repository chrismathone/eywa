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
  /**
   * 이 **행**의 표시명 겸 화면 state 키(reports[studentId][name]). 행 = 반(수업) 1개다(0134a).
   * ⚠️ 같은 과목 두 반(정규 수학 + 수학 특강)을 들으면 로스터가 겹치는 이름에만 반 이름을 덧붙여
   *    유일화한다("수학" → "수학 · 고1 특강"). state 키라 유일하지 않으면 두 행이 서로를 덮는다.
   * ⚠️ **학부모에게 나가는 문자열에 쓰지 말 것** — 반 이름이 섞여 있을 수 있다. 진도 접두사 등
   *    데이터로 저장되는 자리에는 `subjectLabel`을 쓴다.
   */
  name: string; // "영어 독해", "수학 (상)", "국어 문학"
  /**
   * 순수 과목 라벨("수학") — 반 이름이 절대 섞이지 않는다. 진도 텍스트 접두사(`progress`)·직전 진도
   * 접두 매칭처럼 **저장·비교되는 값**은 전부 이걸 쓴다(학부모 카드에 반 이름이 새는 것 방지).
   * 미지정(데모·수동 추가)이면 호출부가 `name`으로 폴백.
   */
  subjectLabel?: string;
  prev: string; // 이전 진도 — "Unit 7 · p.82"
  today: string; // 오늘 진도 — "Unit 8 · p.90"
  // 운영 과목 키(operations.subjects) — 진도 입력 방식 분기에 사용.
  // "math"면 커리큘럼 드롭다운(curriculum.ts), 그 외(영어 등)면 freeform 텍스트.
  // 미지정(데모)이면 "math"로 간주 → 기존 커리큘럼 동작 보존.
  subjectKey?: string;

  // 교재명·보강 — 0089a(edutrix 강사 필드 패리티). 과목별. textbook=학부모 카드에도 표시, makeup=보강 수업.
  textbook?: string;
  makeup?: boolean;
  /**
   * 보강 행이 **어느 수업 시간에** 진행됐는가(0171a `lesson_reports.makeup_class_id`) — 반 필터 앵커.
   * 🔴 보강 행은 `classId`가 없어 반 필터가 가를 수 없었고, 그래서 화면이 보강 학생을 **모든 반 필터에**
   *    노출하고 있었다(원장 제보 2026-08-03 "보강 추가한 수업에서만 보여야"). 이 값이 그 소속이다.
   * null = 앵커 없음(옛 데이터·'전체'에서 추가) → **'전체'에서만** 보인다. name은 화면 표시·필터 비교용.
   */
  makeupClassId?: string | null;
  makeupClassName?: string | null;
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

  // ── 출결 인라인 입력(2단계) — 행(반) 단위. 출결 원장은 (student, class, date)라 행의 반을 보존한다 ──
  // classId: 이 과목 행의 반. null=모호(같은 과목을 두 반에서 수강 — pill 숨김, 출석부에서만 기록).
  classId?: string | null;
  // 이 과목 행의 반 이름 — 반 필터 시 이 행이 그 반 소속인지 판정(다과목/다반 학생 필터 정확도). null=모호.
  className?: string | null;
  /**
   * 이 행의 반이 **특강**인가(`classes.is_special`, 0133a). 정규와 특강을 섞지 않기 위한 축이다.
   * ⚠️ 이관분(`class_id`·`subject` 둘 다 NULL, 실측 17,478행)은 **전부 정규**다 — 특강 반은 최근
   *    만들어졌고 이관 시점엔 존재하지 않았다. 그래서 "반이 안 붙은 옛 보고서"를 특강 행에 붙이면
   *    100% 오배정이다(실제 증상: 특강 행의 '이전 회차'에 정규 수업 진도·교재가 떴다).
   */
  isSpecial?: boolean;
  // 이 반의 대상 날짜 raw status(present/late/absent/early_leave/excused/makeup). null=기록 없음.
  // ⚠️ 표시 축약(toMark)과 별개로 raw를 보존 — 조퇴·공결·보강을 pill이 축약값으로 되쓰는 사고 방지.
  attendanceRaw?: string | null;

  // ── 오늘 보고서 발송 상태(과목별) — roster가 오늘 lesson_reports를 subject로 매칭해 채움 ──
  // 학생단위로 뭉개면 다과목(수학만 저장해도 영어까지 sent)이 오카운트되므로 과목별로 분리.
  reportSent?: boolean; // 오늘 이 과목 보고서가 저장됨
  shareToken?: string; // 오늘 이 과목 보고서의 /r 공유 토큰
  classnoteStatus?: string; // ClassNote 발송 상태(queued/processing/success/failed/too_old, null=미요청)
  // 학부모 읽음 시각(0122a classnote_read_at — 연동 PC 워커가 피드에서 채움, 강사 행 배지용 2026-07-27).
  // ⚠️ **양성 표시 전용**: 없음 = "안 읽음"이 아니라 "아직 동기화 안 됨"일 수 있어 배지를 생략한다
  //    (원장 목록 StatusCell과 같은 규약 — 거짓 '미확인' 방지).
  classnoteReadAt?: string;
  revokedAt?: string; // 공유링크 취소 시각(P2a) — 있으면 링크 열람 차단됨
  viewCount?: number; // 학부모 열람 수(share_link_views count, P2a)
  attachments?: { path: string; name: string }[]; // 학생 사진 첨부(P2b) — /r·ClassNote 스샷에 렌더
};

/** 테스트 점수 표기 모드(0148a). count="20문제 중 18개" / score="95점"(만점 100 고정, v1). */
export type TestScoreMode = "count" | "score";

/** 한 테스트(일일/확인)의 점수 + 만점 + 직전 회차 점수 */
export type TestScore = {
  score: number | null; // 미입력이면 null
  max: number; // count 모드=문항수 / score 모드=만점(100 고정, v1)
  prevScore: number | null;
  /** 표기 모드(0148a). 미지정=count(기존 동작 보존) — 옵셔널이라 다른 TestScore 생성부가 안 깨진다. */
  mode?: TestScoreMode;
  /**
   * 점수 모드로 전환하면 max가 100으로 바뀌므로 **직전 개수 문항수를 기억**해 둔다 → 개수로 돌아올 때 복원
   * (2026-07-24 적대검수: 점수↔개수 왕복 시 문항수가 100으로 굳어 "100문제 중 N개"가 되던 것). 클라 상태 전용.
   */
  countMax?: number;
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
  tag: string; // 필터용 태그 (실데이터=대표 반 이름=최초 반, 데모=학년) — 좌측 그룹 대표
  tags?: string[]; // 이 학생이 수강 중인 담당 반 전체 — 반 필터가 다과목/다반 학생을 양쪽에서 잡도록(누락 방지)
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
  attitude: string | null; // "매우 좋음"~"매우 안좋음"(attitude.ts) | null. 옛 기록엔 "최고"·"아주 좋음"도 있다.
  homework: string; // 과제 수행률 "100%" | "90%" | … | "0%" | "없음" | "" (옛 기록엔 "완료"·"일부 미흡"도 남아 있다)
  note?: string; // 특이사항(강사 메모) — 0093a. AI 멘트 입력(공지 모드 A/B). 학부모엔 생성 문구만. 미설정=빈 메모.

  // ── 로스터 신호(읽기 전용, roster가 채움) — 판정은 roster-signals.ts 순수 함수 ──
  // G3: 학부모 읽음 통계(0124a RPC). 추적 불가 학생은 trackableCount 0 → 배지 자연 침묵.
  parentRead?: import("./roster-signals").ParentReadStats;
  // G2: 진도 이상(수학 파이프라인 전용 — errored 컨테이너/최근 오류 이벤트). 소비처는 math 행에만 표시.
  progressSignal?: import("./roster-signals").ProgressSignal;

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
