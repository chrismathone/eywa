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
  /**
   * 오늘 수업의 **성격**(복습·문제풀이) — 진도 차시와 **함께** 기록되는 별개 축(progress-mode.ts).
   * 없으면(undefined·null) 평소대로 "진도를 진행했다".
   * ⚠️ 진도 문자열(`today`)에 섞어 넣지 말 것 — 진도 위치 매핑이 마지막 줄을 차시로 읽는다.
   */
  progressMode?: string | null;
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

  // ── 행(수업) 단위 평가값 (2026-08-13) — 해석·폴백은 [row-fields.ts](./row-fields.ts) 단일 소스 ──
  /**
   * 🔴 이 일곱 값은 예전엔 **학생 단위**뿐이라 같은 학생의 정규·특강·보강 행이 한 벌을 공유했다.
   *    보강 행에 태도를 넣으면 정규 행에도 들어갔다(원장 제보 2026-08-13, 실측 정규+보강 9쌍 중 8쌍 태도 동일).
   *    보강은 **따로 발송되는 다른 보고서**라 값도 독립이어야 한다 → 행에 얹는다.
   * ⚠️ `undefined` = 이 행에 지정 안 됨 → 학생 값으로 폴백(옛 세션·옛 행은 지금까지와 동일하게 동작).
   *    `null`·`""`은 강사가 **비운 것**이라 폴백하지 않는다. 판정을 호출부에서 새로 짜지 말고
   *    `resolveRowFields(student, subject)`를 쓸 것.
   */
  attitude?: string | null;
  /** 지난 과제 수행률("90%"·"미제출"·"없음") — 행 단위. 미지정=학생 값. */
  homework?: string;
  /** 특이사항(강사 메모, AI 멘트 입력) — 행 단위. 미지정=학생 값. */
  note?: string;
  dailyScore?: number | null;
  dailyMax?: number;
  checkScore?: number | null;
  checkMax?: number;

  /**
   * **ECS 시트에 적힌 그날 그 반 계획**(2026-08-07) — 교재·진도·오늘 과제의 출처.
   * roster가 이 값으로 위 `textbook`/`today`/`homeworkToday`의 **초안**을 채웠고, 화면은 같은 값을
   * "시트에서 가져옴"으로 밝히고 '다시 가져오기'를 제공한다(강사가 고친 뒤에도 원본을 되찾을 수 있게).
   * 없음(undefined) = 그 반의 그날 시트가 비었거나 시트를 안 쓰는 반.
   */
  sheetDraft?: { textbook: string; progress: string; homework: string };
  /**
   * 시트의 **학생별 기록**(`class_sheet_student_marks.progress_note`, 교시 순 개행) — 표시 전용.
   * 🔴 보고서 칸에 **자동으로 넣지 않는다**: "PL 7, 20개 / PV 4" 같은 개인 메모라 문맥이 제각각이고,
   *    그대로 학부모에게 나가면 안 되는 것이 섞일 수 있다. 강사가 보고 직접 옮긴다.
   */
  sheetStudentNote?: string;

  // 직전 회차(이전 작성) 참고용 — roster가 (학생×과목)별 직전 lesson_reports를 담아 표뷰 '이전 회차 참고행'에 렌더.
  // 읽기 전용(편집 불가). 없으면(첫 수업) undefined.
  prevReport?: PrevReport;

  // 복원된 멘트/추세 초안 — roster가 오늘 세션(onescreen_daily_sessions) 우선, 없으면 오늘 발송본
  // (lesson_reports notes/trend_note)에서 채워 initReports가 reports state 초기값으로 사용(새로고침 유지).
  draft?: string;
  trendDraft?: string;
  // 자동작성이 멘트 칸에 마지막으로 넣은 텍스트(0214a 판정 스냅샷) — 세션에서만 복원(발송본엔 없음).
  autoDraft?: string;

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
  /**
   * 이 행의 반이 **'수업보고서 미발송'**(`classes.report_optout`, 0174a)인가.
   *
   * 🔴 2026-08-19 원장: *"보고서는 안보내지만 이제부터라도 출결은 찍을것"*. 그래서 이 반은 로스터에
   *    **남되**(예전엔 통째로 빠져 출결 알약 자체가 없었다) 보고서 쪽 입력·발송·자동작성만 잠근다.
   *    판정은 `isRowInputEditable`/`isRowActionable`(grid.ts) 단일 소스가 이 값을 본다.
   * ⚠️ 출결·수업타임·결석 사유는 **잠그지 않는다** — 이 반이 화면에 돌아온 이유가 그것이다.
   */
  reportOptout?: boolean;
  // 이 반의 대상 날짜 raw status(present/late/absent/early_leave/excused/makeup). null=기록 없음.
  // ⚠️ 표시 축약(toMark)과 별개로 raw를 보존 — 조퇴·공결·보강을 pill이 축약값으로 되쓰는 사고 방지.
  attendanceRaw?: string | null;
  /**
   * 이 반의 대상 날짜 출석부 메모(`attendance_records.note`) — 지각·결석 사유 창의 초기값(2026-08-05).
   * 출석부와 **같은 칸**이라 여기서 고치면 출석부에도 그대로 반영된다.
   */
  attendanceNote?: string | null;
  /**
   * 이 반의 대상 날짜 시수(`attendance_records.session_units`, null=기본 1) — 화면 '타임' 칸의 값.
   * ⚠️ **학부모 보고서엔 안 나간다**(발송물이 아니라 기록). 급여 정산·청구 회차 소비는 이 값을 읽는다.
   */
  attendanceUnits?: number | null;

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

/**
 * 한 테스트(일일/확인)의 점수 + 문항수 + 직전 회차 점수.
 *
 * 🔴 표기는 **맞은 개수 하나뿐**이다(원장 2026-08-11: "점은 제거하고 갯수로만"). 0148a가 넣었던
 *    '점수(100점 만점)' 표기 모드는 제거됐다 — 실사용 0(전 테넌트 설정 count, 세션 1,144행 전부 count,
 *    저장된 '점' 표기 0건)이라 이관할 데이터가 없었다. `daily_score_mode`·`check_score_mode` 컬럼은
 *    남아 있지만 **아무도 읽지 않는다**. 척도가 하나뿐이라 prevScore 척도 경계 문제도 사라졌다.
 */
export type TestScore = {
  score: number | null; // 미입력이면 null (= 맞은 개수)
  max: number; // 문항수
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
  grade: string; // 실제 학년 — "초1" ~ "중3"
  /** 학교명 — 학부모 보고서 "학교 · 학년" 표기 전용(fmtSchoolGrade). 미상=빈 문자열. */
  school?: string;
  tag: string; // 필터용 태그 (실데이터=대표 반 이름=최초 반, 데모=학년) — 좌측 그룹 대표
  tags?: string[]; // 이 학생이 수강 중인 담당 반 전체 — 반 필터가 다과목/다반 학생을 양쪽에서 잡도록(누락 방지)
  className?: string; // 강사 담당 반 이름 — 원스크린 좌측 반별 그룹/필터
  classId?: string;
  // 진도(수업) 학년 — 실제 학년과 다를 수 있음(선행/후행). 없으면 grade로 간주.
  studyGrade?: string;
  // 보강·수업외 학생(수동 추가) — true면 세션 자동저장(onescreen_daily_sessions) 건너뛰고(반 없음),
  // 저장 시 outOfClass로 담당반 검사 우회(같은 학원 학생이면 허용). roster엔 없고 클라에서만 추가됨.
  isMakeup?: boolean;
  /**
   * 이 강사 세션 행의 `updated_at`(onescreen_daily_sessions). 자동저장이 같은 값을 돌려주면
   * 이 창이 마지막 저장자라 칸을 비워도 되고, 다르면 덜 쓴 창의 저장은 서버가 무시한다.
   */
  sessionUpdatedAt?: string;
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
