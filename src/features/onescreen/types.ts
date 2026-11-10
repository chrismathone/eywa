/**
 * 선생님 원스크린 — 타입.
 * 프로토타입(data/원스크린_전달/data.js)의 학생 shape를 그대로 타입화.
 * 데모 충실 이식: 입력은 클라이언트 state로만 돌고 DB에 영속화하지 않는다.
 */
import type { MonthlyEval } from "@/features/report-templates/monthly-eval";
import type { MonthlyActivity } from "@/features/report-templates/monthly-activity";

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
  /**
   * 영어 반의 Monthly Test 점수(2026-11-05, EiE 월간 보고서) — 로스터가 이 반·이 학생의 가장 최근(이번 달·지난달) 점수를 싣는다.
   * 없으면(점수 없음·영역 칸 미적용·조회 실패) undefined — 월간 템플릿의 점수 줄이 빠질 뿐 다른 동작은 그대로다.
   */
  monthlyEval?: MonthlyEval;
  /** 그 반·그 달 일일 보고서에서 모은 숙제·태도·단어 테스트(2026-11-06, EiE 월간 보고서 — EiE 반만). 없으면 기록 줄이 빠진다. */
  monthlyActivity?: MonthlyActivity;
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
  /**
   * 오늘 영상 과제 있음(0308a, 원장 2026-09-30) — 행 단위. 켜면 다음 수업에서 '지난 수업 영상 숙제'를 검사한다.
   * 학원설정 영상 숙제 정책이 이 반을 켠 행에서만 저장된다(끈 반은 undefined로 보내 값을 건드리지 않는다).
   */
  videoHomework?: boolean;
  /**
   * 영상 첨부 링크 넣기(0328a, 원장 2026-10-02) — 행 단위. '영상 과제'를 켠 행에서만 고른다. 켠 보고서에만
   * ClassNote 글에 '영상첨부 : …/v/…' 줄이 붙는다. `undefined` = 고른 적 없음(저장에 싣지 않는다 — 저장돼 있던 값을 덮지 않게).
   */
  videoSubmitLink?: boolean;
  /**
   * 영상 숙제 **마감**(원장 2026-10-15) — 7일(기본) 또는 다음 수업. '영상 과제'를 켠 행에서만 고른다(video-homework/due.ts).
   * `undefined` = 고른 적 없음(저장에 싣지 않는다 — 저장돼 있던 마감을 덮지 않게. 새 보고서는 7일).
   */
  videoHomeworkDue?: "week" | "next";
  /** 서버가 정한 '다음 수업' 날짜(저장 뒤·다시 연 화면에서만 안다) — 표시·멘트 재료. */
  videoHomeworkDueDate?: string;

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
  /**
   * 소단원별 이해도(10점 만점) — 수학 보고서 시범(테스트 학생 한정, math-report-pilot.ts) 행에서만 쓴다.
   * 세션 `subject_progress`에 실려 새로고침 뒤에도 남는다(보고서 행에는 저장하지 않는다 — 자동작성 재료다).
   */
  understanding?: import("./math-report-pilot").UnderstandingState;
  /**
   * 일일 테스트 '없음'과 그 사유(수학 보고서 시범, math-report-pilot-sections.ts) — 시범 행에서만 쓴다. `null`·없음 = 시험 있음.
   * 세션 `subject_progress`에 실려 새로고침 뒤에도 남는다(보고서 행에는 저장하지 않는다 — 자동작성 재료다).
   */
  dailyTestSkip?: import("./math-report-pilot-sections").DailyTestSkip | null;
  /**
   * 숙제 미제출 사유(수학 보고서 시범) — 숙제 완성도가 미제출·0%일 때 강사가 적는다(원장 2026-10-23). 시범 행에서만 쓴다.
   * 세션 `subject_progress`에 실려 새로고침 뒤에도 남는다(자동작성 재료).
   */
  homeworkMissReason?: string;
  /**
   * 수업 태도 의견(새 수학 보고서) — 태도가 하·중하일 때 강사가 3줄 이상 직접 적는다(원장 2026-10-26). '수업 태도' 항목에 그대로 들어간다.
   * 세션 `subject_progress`에 실린다(homeworkMissReason과 같은 길).
   */
  attitudeNote?: string;
  /**
   * '오늘의 수업' 메모(새 수학 보고서, 원장 2026-10-28) — 그날 수업에서 한 일을 선생님이 짧게 적는다. AI가 '오늘의 수업'에 녹여 쓴다.
   * 세션 `subject_progress`에 실린다(attitudeNote와 같은 길).
   */
  lessonMemo?: string;
  /**
   * 보강 사유(보강 행) — 결석 날짜를 예약에서 못 찾을 때 강사가 적는다(원장 2026-10-26). 보고서 '출결' 문장 끝에 "(사유: …)"로 붙는다.
   * 세션 `subject_progress`에 실린다.
   */
  makeupReason?: string;
  dailyScore?: number | null;
  dailyMax?: number;
  /**
   * 오늘 수학 채점 결과로 채웠거나 같은 값인 칸(2026-10-17 · `todays-math-fill-rules.ts`) — 화면의 '오늘 수학' 표식 전용.
   * 오늘 수학이 준 값을 그대로 들고 있고, 화면은 **지금 칸 값이 이 값과 같을 때만** 표식을 단다(`todaysMathMarked`) —
   * 선생님이 어느 길(직접 입력 · 일괄 적용 · 복사)로 고치든 표식이 저절로 풀린다. 저장(세션·보고서)엔 싣지 않는다.
   */
  todaysMath?: { daily?: { score: number; max: number }; check?: { score: number; max: number } };
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
  /** 자동작성이 추세 칸에 마지막으로 넣은 글(세션에서만 복원) — '달라진 것 없음'이면 칸이 이 글 그대로일 때만 비운다. */
  trendAutoDraft?: string;
  /** autoDraft가 AI 원문이 아니다(실패 폴백 템플릿·지난 회차 복사) — 자동작성 원문(0370a)으로 싣지 않는다. */
  autoDraftTemplate?: boolean;
  /**
   * 영어 템플릿 모드(2026-09-10) — 세션에서 복원한 값. **영어 행에서만** 쓰인다(수학 세션엔 키가 없다).
   * templateId = 고른 템플릿(없으면 기본) · nextTest = 다음 시간 테스트 안내 ·
   * aiIntro/aiComment = 마지막 AI 인사말·코멘트(템플릿을 바꾸거나 다시 채울 때 AI를 다시 부르지 않고 쓴다).
   */
  templateId?: string;
  nextTest?: string;
  /** EiE 일일 보고서(2026-11-06) — 단어 테스트 피드백 · 재시험. 세션 복원값(영어 행만). */
  wordFeedback?: string;
  wordRetest?: boolean;
  aiIntro?: string;
  aiComment?: string;
  /** 템플릿이 마지막으로 만든 글의 지문 · AI에 넘긴 사실의 지문(provenance.ts) — 세션 복원값. */
  templateHash?: string;
  aiFactsHash?: string;
  /** 지금 글을 짤 때 쓴 칸 값의 지문(templateFactsKey) — 세션 복원값. */
  composedFactsHash?: string;

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
  /**
   * **수업 나누기로 그 시간 이 반에 온 학생**의 행(0351a) — 값은 표식 문구(`나눔 17:20~18:20 ← 이성우(중1 수학)`).
   * 수강행이 없는 행이라 `reportOptout: true`가 함께 실려 보고서 쪽이 잠긴다(보고서는 원래 반 담임 몫 — 원장 2026-10-06).
   * 출결 알약은 열린다(이 반에 찍힌다 = 받는 선생님 몫). 판정·문구는 [split-rows.ts](./split-rows.ts).
   */
  splitIn?: string;
  /** **원래 반** 행인데 그날 일부 시간이 다른 반으로 나눠짐 — 표식 문구(`17:20~18:20 → 유형숙(중1 개별)`). 표시 전용. */
  splitOut?: string;
  /**
   * 이 줄에 걸린 **그날 보강 예약**(0264a — 출석부에서 미리 잡은 보강) — 표식 전용(`reserved-makeup.ts`).
   * 정규 수업일 예약은 정규 줄에 합쳐져 따로 줄이 안 서서, 예전엔 원스크린 어디에도 보강이 보이지 않았다(원장 2026-10-22 전주율 건).
   */
  makeupReserved?: ReservedMakeup[];
  /** 정규 줄의 '정규+보강'이 **보강 예약(합침)** 에서 왔다 — 합침 취소 대신 예약을 바꾸게 한다(새로고침이 다시 합친다). */
  makeupByReservation?: true;
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
  /**
   * 이 반의 대상 날짜 **수학 자동 시수**(수업 길이 → 시수, 원장 2026-09-11, attendance/auto-units.ts) —
   * 출결을 **처음** 찍을 때 서버가 넣는 값. 화면 '타임' 칸이 기록 없는 행에서 이 값을 기본으로 보여 준다.
   * 1이거나 대상이 아니면 키가 없다(로스터는 전 강사 hot path라 모든 행에 null을 얹지 않는다).
   */
  attendanceAutoUnits?: number | null;

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

/** 학생 배지(축약) — 모으는 규칙·우선순위는 [attendance-mark.ts](./attendance-mark.ts) `studentMarkOf`. */
export type AttendanceMark = "출석" | "지각" | "조퇴" | "결석";

/** 원스크린 줄의 보강 예약 한 건(표식 재료). 시각은 "HH:MM". */
export type ReservedMakeup = {
  start: string;
  end: string;
  /** 결석분 날짜(YYYY-MM-DD). */
  absenceDate: string;
  /** 보고서 발송 방식 — 정규 수업일이 아닌 예약은 늘 separate(합칠 정규 보고서가 없다). */
  mode: "merge" | "separate";
  /**
   * 출결이 찍혀 이행됐다(시수 반영). 🔴 표식 '보강 완료'는 이것만으로 켜지 않는다 — 예약 끝 시각이 지나야(`reservedShownDone`).
   * 수학은 하루 한 칸이라 정규 출석을 찍는 순간 이행되는데, 정규 수업 **뒤** 보강(권민서A 18:20~19:15 — 16:24 출석)은 아직 하지 않았다.
   */
  done: boolean;
  /** 보강일(YYYY-MM-DD) — 끝 시각이 지났는지 판정. 없으면(옛 값) `done`만 본다. */
  date?: string;
  /**
   * 선생님이 보강을 했다고 확인했나(0458a `checked_at` · 원장 2026-10-27). 없음 = 확인 칸이 아직 없다(종전 판정 · 발송 게이트 없음).
   * false = 아직 확인 전 → 표식 '보강 진행 여부 확인해 주세요'(끝 시각 뒤) · 그 보강이 든 보고서는 발송 막힘(`needsMakeupCheck`).
   */
  checked?: boolean;
};

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
  /** 학생 배지 — 행 raw에서 계산한다(`studentMarkFromRows`). 직접 고치지 말 것. */
  attendance: AttendanceMark;
  /**
   * 내 반의 그날 출결인데 **반이 있는 행에 못 붙은** 칸의 raw 상태들(반 모호 행 등) — 배지 계산 재료로만 쓴다.
   * 반 id → 그 반의 그날 최신 raw. 로스터가 채우고, 스트립 방송·보강 삭제가 **같은 반 키로** 고친다
   * (키가 없으면 정정이 와도 옛 결석이 배지에 영원히 남는다 — 적대 리뷰 2026-09-30). 없으면 빈 것.
   */
  attendanceOffRow?: Record<string, string>;
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
