import "server-only";
import { stripTextbookPages } from "../textbook-carry";
import { DEFAULT_DISPLAY_OPTIONS, type DisplayOptions } from "../display-options";
import { lessonEndsByClass } from "../send-mark";
import { splitOnescreenPrefs } from "../pref-owner";
import type { TemplatePrefs } from "../last-template";
import type { VideoHomeworkDueMode } from "@/features/video-homework/due";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { viewAsTeacher } from "@/lib/auth/view-mode";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { ReportSettings } from "@/features/owner/settings-types";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import {
  buildSheetDraft,
  hasSheetDraft,
  type SheetDraft,
  type SheetPlanLine,
} from "@/features/class-sheets/sheet-report-draft";
import { resolveBrandingSrc } from "@/lib/storage/media-storage";
import { reportLogoPath } from "@/features/owner/report-logo";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
// 담당 반 판정 단일 소스(담당 반 ∪ 그날 위임 반) — classes.teacher_id를 직접 비교하지 말 것(0173a).
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { addDays, resolveReportDate, weekdayIndexOf, formatKoreanDate } from "@/lib/date-kst";
import { parseExamScores, parseExamMaxes } from "../exam-info";
import { classnoteSendWindowLabel } from "../classnote-guard";
import { applyStudentOrder } from "../student-order";
import { rosterIncludesEnrollment } from "../roster-filter";
import { CLASS_TAG_ALL } from "../class-tags";
import { conductedPairs, foreignClassIds, rosterNativePairs } from "@/features/makeups/roster-merge";
import { loadNativeParticipants, participantsOrLegacy } from "@/features/makeups/server/adapters/participants";
import type { ParticipantRead, ReadOutcome } from "@/features/makeups/types";
import { matchReportsToRows } from "../report-unit";
import { ownsMakeupReport } from "../makeup-owner";
import { makeupSessionEntries } from "../makeup-session";
import { makeupStudentIds } from "@/features/attendance/input-roster";
// 보강 예약(0264a) — 그날 내 반에 예약된 학생을 보강 행으로 미리 세운다. 별도 함수·fail-soft(hot path 보호, #95).
// 이행분까지 + 보고서 발송 방식(합침/분리)을 읽는다 — 정규 줄 표식·'정규+보강'·분리 '(보강)' 줄(reserved-makeup.ts, 원장 2026-10-22).
import { getRosterReservationsOn } from "@/features/attendance/server/makeup-reservation-queries";
import { applyReservedMakeup, planReservedMakeup } from "../reserved-makeup";
import { holidayNameOrNull } from "@/features/attendance/server/holiday";
import { getSplitsOnDate } from "@/features/class-splits/server/queries";
import { loadEnglishMonthlyActivities, loadEnglishMonthlyEvals } from "./english-monthly";
import { planSplitRows } from "../split-rows";
import { autoUnitsOn, isAutoUnitsSubject, toAutoUnitsSchedule } from "@/features/attendance/auto-units";
import { getLessonProfile } from "@/features/owner/server/lesson-profile";
import { LEGACY_REPORT_SUBJECT, reportSubject } from "@/features/timetable/lib/report-subject";
import { carryProgress } from "../progress-status";
import {
  DEFAULT_ONESCREEN_FONT_SIZE,
  type OnescreenFontSize,
} from "../font-size";
import { getTextbookOrdersForStudents } from "@/features/billing/server/textbook-queries";
import type { OneScreenStudent } from "../types";
import { isFeatureOptedIn } from "@/lib/license/server";
import { applyTodaysMathFill, loadTodaysMathFill } from "./todays-math-fill";
import { studentMarkFromRows } from "../attendance-mark";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
import { readLessonMemo, readUnderstanding } from "../math-report-pilot";
import { readAttitudeNote, readHomeworkMissReason, readMakeupReason, readTestSkip } from "../math-report-pilot-sections";

/**
 * 선생님 원스크린 — 실데이터 로더(데모 스냅샷 대체).
 *
 * 강사 **본인의** 오늘 담당 반·학생만 조회한다(강사 스코프 = 다른 강사 데이터 누수 없음).
 * 진도/테스트/태도/보고서 값은 빈 상태로 시작 → 강사가 입력(데모 UI 흐름 동일).
 * 오늘(현재 요일) 수업이 있는 반의 학생을 보여주고, 오늘 수업이 없으면(주말 등) 전체 담당 반으로 폴백.
 */

const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const; // Date.getDay()

/** 오늘 수업(반) 한 줄 — 원스크린 '오늘 일정' 위젯용 */
export type TodayClass = {
  id: string;
  name: string;
  /** 과목 **표시 라벨**(학원설정 `labelOf`, 예 "수학") — 화면에 적는 값. 🔴 과목 비교에 쓰지 말 것(아래 `subjectKey`). */
  subject: string;
  /**
   * 과목 **키**(`classes.subject`, 예 "math") — 보강 줄 거르기처럼 과목을 **비교**할 때는 이 값이다. 모르면 "".
   * 🔴 원장 제보 2026-09-14(권영준·이수진): 보강 추가가 라벨("수학")을 키("math")와 비교해, 반 칩을 고른 채
   *    보강 학생을 추가하면 보강 줄이 0개가 되어 "보강 날짜와 과목을 확인해 주세요"로 막혔다.
   */
  subjectKey: string;
  startTime: string | null; // "16:20"
  endTime?: string | null; // 오늘 마지막 교시 종료 시각(미발송 안내)
  studentCount: number;
  /**
   * 이 반이 **위임받은 반**인가(0173a — 결근 대체 수업). 내 담당 반이면 false.
   * 반 칩이 '내 반'과 시각적으로 구분해야 한다(원장 지시 2026-08-03: "기존 내 반과 구분해서 위임 반 목록이
   * 나오도록 디자인적으로도 구분") — 남의 반 학생에게 내 반처럼 보고서를 쓰는 사고를 화면이 먼저 막는다.
   */
  delegated: boolean;
  /** 위임 반일 때 원 담임 표시명(모르면 null). 내 반이면 null. */
  ownerName: string | null;
  /**
   * '수업보고서 미발송' 반(0174a) — 칩에 표식을 달아 **출결만 찍는 반**임을 먼저 알린다.
   * 반을 눌러 보고서 칸이 전부 잠긴 뒤에야 알게 되면 "왜 안 써지지"가 된다(2026-08-19).
   */
  reportOptout: boolean;
  /**
   * **내 반인데 지금 남이 대신 맡고 있음** — 그 대체 강사 표시명(아니면 null).
   * 하루만 위임하고 나머지 날은 내가 하는 일이 흔해서, 위임 건 날에 내 화면이 침묵하면 같은 반 보고서를
   * 둘이 각자 쓰게 된다. 권한은 그대로 두고 칩에 표식만 단다(원 담임은 여전히 자기 반을 쓸 수 있다).
   */
  delegatedAwayTo: string | null;
};

export type TeacherRoster = {
  today: string; // 표시용 "2026년 6월 20일 (금)" — 조회 대상 날짜(오늘 또는 과거)
  date: string; // 조회 대상 날짜(YYYY-MM-DD) — 저장/발송이 이 날짜로 report_date를 씀(오늘 기본, 과거 이동 가능)
  classTags: string[]; // ["전체", ...현재 로스터에 있는 학년]
  teacherName: string;
  students: OneScreenStudent[];
  todayClasses: TodayClass[]; // 그 날짜에 수업이 있는 담당 반 — 시작시각순('전체 보기'면 담당 반 전체)
  /**
   * 그 요일에 담당 수업이 **하나도 없음**. true면 화면이 "오늘은 수업이 없습니다"를 말해야 한다.
   * ⚠️ 2026-07-22 원장 제보: 수요일 수업이 없는 강사(이수진)의 원스크린에 **담당 반 7개·학생 37명**이
   * 그대로 떴다 — 옛 코드가 "그 요일 반 0개 → 담당 반 전체"로 조용히 폴백했기 때문. 작성률 화면은 같은 날
   * "수업 없음"이라 말하고 있어 **두 화면이 서로 다른 말**을 했고, 강사는 안 오는 학생 37명분을 입력할 수
   * 있었다(발송은 0이라 막히지만 헛수고 + 출결 pill도 열림). 폴백은 이제 **명시 선택**(showAll)일 때만.
   */
  noClassesToday: boolean;
  /** 지금 '담당 반 전체 보기'로 보고 있는가(요일 조건 미적용) — 화면이 그 사실을 밝힌다. */
  showingAll: boolean;
  /**
   * 그 날짜가 학원설정 휴원일이면 그 이름(아니면 null) — 출결 화면과 같은 판정(`holidayNameOrNull`).
   * 🔴 명단은 그대로 둔다 — 휴원일에도 실제로 수업하는 날이 있다(2026-10-03 개천절에 원스크린으로 출결을 넣었다).
   *    화면은 안내 띠를 세우고 일괄 출결(일괄 출석·값 일괄 적용)만 한 번 확인한다
   *    (원장 2026-10-13 — 10/9 한글날에 금요일 반 19명이 일괄 출석으로 찍혔다).
   */
  holidayName: string | null;
  /**
   * 맡은 보강 배정을 읽지 못했다 — 화면이 그대로 알린다(빈 명단을 "오늘 할 일 없음"으로 읽지 않게). 평소엔 없다.
   * 수업이 없는 날에도 온다: 그날 화면에 설 사람이 맡은 보강 학생뿐일 수 있어서다.
   */
  makeupNotice?: string | null;
  allowTeacherTestMax: boolean; // 강사가 테스트 문항수(/N) 직접 변경 허용(report 설정) — 원스크린 입력 UI 분기
  // 일일/확인테스트 사용 여부 = 보고서 '표시 항목' 토글(showDailyTest/showCheckTest) 재사용. off면 원스크린
  // 점수 입력칸을 숨겨(입력 안 함) + 학부모 보고서에도 미표시(parent-report-card). 표시·입력 단일 스위치.
  showDailyTest: boolean;
  showCheckTest: boolean;
  noticeMode: "A" | "B" | null; // 강사 본인의 AI 멘트 모드 오버라이드(null=학원 기본 따름) — 0104a
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드(report.noticeMode) — 토글 '학원 기본' 라벨 표시용
  classnoteSendEnabled: boolean; // ClassNote 실제 발송 스위치 — 공지 컴포저 dry-run 안내용
  classnoteOn: boolean; // ClassNote 기능(모듈) 켜짐 — 꺼지면 발송 현황·달력·공지·C.N 표시를 감춘다(2026-09-30)
  // 발송 허용 시간창(HH:MM 원문, 무제한=null) — 원스크린 상단 강사 안내용. 활성 판정은
  // classnoteSendWindowLabel(워커 fail-open 규약 미러). **표시 여부는 클라가 현재 KST로 재판정**
  // (창 밖일 때만 노출, 원장 지시 2026-07-29)이라 라벨이 아니라 원문 시각을 내린다. 빈 로스터는 null 고정.
  sendWindow: { start: string; end: string } | null;
  // 사진/파일 첨부 표시(report.showAttachments) — off면 첨부는 저장되지만 /r·인쇄·ClassNote 어디에도 안 실린다.
  // 강사 카드가 첨부 칸에 그 사실을 경고로 띄운다(입력 시점 고지 = 거짓 약속 차단, 2026-07-21).
  showAttachments: boolean;
  // 출결 쓰기 권한(학원설정 역할·권한). false면 원스크린 pill을 표시 전용으로 — 서버가 거절할 일을
  // 화면이 눌리게 보여주지 않는다(2026-07-21: 강사 attendance=none인데 pill이 눌려 "권한 없음" 토스트만 떴다).
  canEditAttendance: boolean;
  // 강사 개인 '글씨 크기'(작음/보통/큼) — users.ui_prefs.onescreen.fontSize(계정 귀속, 기기 아님).
  // 미설정=작음(지금 화면 그대로)이라 아무도 손대지 않으면 렌더가 바뀌지 않는다.
  fontSize: OnescreenFontSize;
  displayOptions: DisplayOptions;
  // '학습 추세 미발송'으로 켠 `반:학생` 키(원장 2026-09-18) — 글씨 크기와 **같은 행**(ui_prefs)에서 읽어 왕복 0.
  trendOptOut: string[];
  // 영어 보고서 템플릿 내 기본값 = 마지막으로 고른 템플릿(원장 2026-10-27, last-template.ts) — 같은 ui_prefs 행이라 왕복 0.
  templatePrefs: TemplatePrefs;
  // 영상 숙제 마감의 내 기본값(7일 · 다음 수업, 원장 2026-10-28, video-homework/due-pref.ts) — 같은 ui_prefs 행이라 왕복 0.
  videoDueDefault: VideoHomeworkDueMode;
  // ── 카드 뷰 '학부모 미리보기'(2026-08-05 원장 요청) — 오른쪽에 실제 발송물을 그대로 그린다 ──
  // ⚠️ 미리보기는 /r·인쇄와 **같은 컴포넌트**(ParentReportCard)를 쓴다. 그래서 표시 토글도 같은 값이어야
  //    한다 — 여기서 report 설정을 통째로 내려 "미리보기엔 있는데 학부모 화면엔 없는 항목"이 생기지 않게 한다.
  reportSettings: ReportSettings;
  academyName: string;
  logoSrc: string | null; // 이미 해석된 로고 URL(showLogo가 꺼져 있거나 로고 미설정이면 null)
};

type OnescreenSessionRow = {
  student_id: string;
  study_grade: string | null;
  subject_progress: Record<
    string,
    {
      today?: string;
      /** 오늘 수업 성격(복습·문제풀이) — progress-mode.ts. 없으면 평소대로 '진도'. */
      mode?: string;
      draft?: string;
      trendDraft?: string;
      /** 자동작성이 멘트 칸에 마지막으로 넣은 텍스트(0214a 스냅샷) — 복원해야 재접속 후 저장이 manual로 오표기되지 않는다. */
      autoDraft?: string;
      /** 자동작성이 추세 칸에 마지막으로 넣은 글(2026-10-16) · autoDraft가 AI 원문이 아님(0370a) — 같은 규약으로 복원. */
      trendAutoDraft?: string;
      autoDraftTemplate?: boolean;
      textbook?: string;
      makeup?: boolean;
      homeworkToday?: string;
      /** 오늘 영상 과제 있음(0308a) — saveOnescreenSession 입력과 같은 키. */
      videoHomework?: boolean;
      /** 영상 첨부 링크 넣기(0328a) — saveOnescreenSession 입력과 같은 키. */
      videoSubmitLink?: boolean;
      /** 영상 숙제 마감(원장 2026-10-15) — saveOnescreenSession 입력과 같은 키. */
      videoHomeworkDue?: "week" | "next";
      /** 영어 템플릿 모드(2026-09-10) — 영어 행만 실린다(saveOnescreenSession 입력과 같은 키). */
      templateId?: string;
      nextTest?: string;
      wordFeedback?: string;
      wordRetest?: boolean;
      aiIntro?: string;
      aiComment?: string;
      templateHash?: string;
      aiFactsHash?: string;
      composedFactsHash?: string;
      /**
       * 행(수업) 단위 평가값 — 2026-08-13. 이 항목이 있는 행만 독립 값을 갖고, 없으면 아래 세션 컬럼
       * (학생 단위)으로 폴백한다(row-fields.ts `resolveRowFields`). 옛 세션은 전부 후자라 동작 불변.
       */
      attitude?: string | null;
      homework?: string;
      note?: string;
      dailyScore?: number | null;
      dailyMax?: number;
      checkScore?: number | null;
      checkMax?: number;
      /** 소단원별 이해도(수학 보고서 시범) — saveOnescreenSession 입력과 같은 키. 모양은 readUnderstanding이 다시 본다. */
      understanding?: unknown;
      /** 일일 테스트 '없음' 사유(수학 보고서 시범) — 모양은 readTestSkip이 다시 본다. */
      dailyTestSkip?: unknown;
      /** 숙제 미제출 사유(수학 보고서 시범) — 모양은 readHomeworkMissReason이 다시 본다. */
      homeworkMissReason?: unknown;
      /** 수업 태도 의견(새 수학 보고서, 2026-10-26) — 모양은 readAttitudeNote가 다시 본다. */
      attitudeNote?: unknown;
      /** '오늘의 수업' 메모(새 수학 보고서, 2026-10-28) — 모양은 readLessonMemo가 다시 본다. */
      lessonMemo?: unknown;
      /** 보강 사유(보강 줄, 2026-10-26) — 모양은 readMakeupReason이 다시 본다. */
      makeupReason?: unknown;
    }
  > | null;
  daily_score: number | null;
  daily_max: number | null;
  check_score: number | null;
  check_max: number | null;
  attitude: string | null;
  homework: string | null;
  special_note: string | null;
  progress_confirmed: boolean | null;
  updated_at: string | null;
};

/** 학원·강사 설정에서 온 값 — 빈 로스터도 정상 로스터와 **같은 값**을 실어야 한다(아래 emptyRoster 주석). */
type RosterSettings = Pick<
  TeacherRoster,
  | "allowTeacherTestMax"
  | "showDailyTest"
  | "showCheckTest"
  | "noticeMode"
  | "academyNoticeMode"
  | "classnoteSendEnabled"
  | "classnoteOn"
  | "sendWindow"
  | "showAttachments"
  | "canEditAttendance"
  | "fontSize"
  | "displayOptions"
  | "trendOptOut"
  | "templatePrefs"
  | "videoDueDefault"
  | "reportSettings"
  | "academyName"
  | "logoSrc"
  | "holidayName"
>;
type RosterConfig = Partial<RosterSettings & Pick<TeacherRoster, "noClassesToday" | "showingAll" | "makeupNotice">>;

/**
 * 빈 로스터(학생 0명).
 *
 * ⚠️ 학원설정에서 온 값(테스트 표시·첨부·발송 시간창·발송 스위치)은 **반드시 그대로 실어라** — 하드코딩 금지.
 * 이 경로는 '그 요일에 담당 수업 없음'에서도 오는데, 그 화면에서도 강사는 상단 '+ 보강 학생 추가'로 학생을
 * 넣어 보고서를 쓰고 발송한다(보강은 요일과 무관 — 서버 게이트도 outOfClass로 열려 있다, 2026-07-22 확인).
 * 값을 하드코딩하면 **그 보강 행만** 학원설정을 무시한다(발송 시간대 안내 증발, 꺼둔 테스트칸·첨부칸 노출).
 * 그래서 기본값은 "설정을 아직 못 읽은 경우"(비로그인)용이고, 읽은 뒤엔 항상 config로 덮어쓴다.
 */
/** 그날 **내가 쓴** 보강(수업외) 보고서 — 화면 행 복원 재료. */
type MakeupReportRow = {
  student_id: string;
  subject: string | null;
  makeup_class_id: string | null;
  created_by: string | null; // 작성 계정(0172a) — 소유 판정의 1차 키
  teacher_name: string | null; // 0172a 이전 행의 폴백 키(표시 이름 문자열)
  makeup_class_name?: string | null;
};

/**
 * 🔴 보강 행은 반이 없어 수강생 로스터엔 **절대** 안 잡힌다. 예전엔 화면에서 '+ 보강 학생 추가'로 만든
 *    임시 클라 행이 전부라, 저장·발송까지 끝낸 보강이 **새로고침 한 번에 사라졌다**
 *    (원장 제보 2026-08-03: "하은결 보강 보고서를 발송했는데 화면에서 찾을 수 없다" — DB엔 멀쩡히 있었다).
 *    그날 보강 보고서와 명단 세션을 읽어 행을 되살린다 = 보강 기록의 원천이 DB가 된다.
 * 범위: (그 학원, 그 날짜, 본인). 날짜+본인으로 좁혀 수십 행(B2 안전).
 *
 * 🔴 **`class_id IS NULL`이 빠지면 안 된다**(2026-08-05 적대 리뷰에서 잡음). 같은 날 정규+보강을 합치면
 *    **정규 보고서**가 `makeup=true`인데 반이 붙은 행이 된다 — 그것까지 여기서 집으면 아래 5-b가 그 과목의
 *    "(보강)" 행을 **한 줄 더** 만들어 낸다(504의 중복 가드는 `!su.classId`인 보강 행만 본다). 그러면
 *    새로고침 한 번에 빈 보강 행이 되살아나고, 강사가 그걸 채워 보내면 **결국 두 번 발송**된다 —
 *    합치기 기능이 막으려던 바로 그 일이다. 여기서 되살릴 대상은 **반이 없는 순수 보강**뿐이다.
 * ⚠️ error를 `?? []`로 삼키지 않는다(B3) — 조용히 0건이면 "또 사라졌다"가 된다.
 */
async function fetchMyMakeupReports(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  date: string,
  userId: string,
  teacherName: string,
): Promise<MakeupReportRow[]> {
  const [{ data, error }, sessions] = await Promise.all([supabase
    .from("lesson_reports")
    .select("student_id, subject, makeup_class_id, created_by, teacher_name")
    .eq("report_date", date)
    .eq("makeup", true)
    .is("class_id", null), // 순수 보강만 — 합쳐진 정규 보고서는 제외
    supabase.from("onescreen_daily_sessions")
      .select("student_id, subject_progress").eq("tenant_id", tenantId)
      .eq("session_date", date).eq("updated_by", userId),
  ]);
  if (error) throw new Error(`보강 보고서 조회 실패: ${error.message}`);
  if (sessions.error) throw new Error(`보강 명단 조회 실패: ${sessions.error.message}`);
  // 소유 판정은 순수 함수 [`ownsMakeupReport`](../makeup-owner.ts) 하나로 — 계정 id 우선, 옛 행만 이름 폴백.
  // 하루치 보강은 학원 전체로도 수십 건(실측 9개월 171건)이라 서버에서 걸러도 비용이 없다 —
  // PostgREST `.or()`에 이름 문자열을 끼워 넣는 것보다 이 편이 안전하다(따옴표·특수문자 이스케이프 위험 0).
  // ⚠️ 회수된 보강도 **그대로 되살린다** — 회수는 "게시글만 지우고 다시 보낼 수 있다"는 흐름이라
  //    (원장 2026-08-06) 행을 숨기면 수정 후 재발송 경로가 끊긴다. 보강 빼기는 발송분을 아예 막고
  //    (취소 불가) 지울 수 있는 행만 **진짜 삭제**하므로, 여기서 상태로 거를 이유가 없다.
  const reports = ((data ?? []) as MakeupReportRow[]).filter((r) =>
    ownsMakeupReport({ createdBy: r.created_by, teacherName: r.teacher_name }, userId, teacherName),
  );
  // 보고서가 없는 '추가만 한 보강'도 같은 복원 경로에 넣는다. 본인·날짜가 다른 세션은 읽지 않는다.
  const sessionRows = (sessions.data ?? []).flatMap(row => makeupSessionEntries(row.subject_progress).map(entry => ({
    student_id: row.student_id as string, subject: entry.subject,
    makeup_class_id: entry.makeupClassId ?? null, makeup_class_name: entry.makeupClassName,
    created_by: userId, teacher_name: teacherName,
  })));
  // 보고서 행의 보강 반 **이름** — 대신 보강(학생의 원래 반, 원장 2026-09-30)은 내 반 목록 밖이라 이름을 모른다. 같은 조회로 이미 받은
  // 명단 세션(확인창이 반 이름을 함께 적어 둔다)에서 채운다 — 새 조회·새 컬럼 없음([[#95]] 핫패스).
  const sessionName = new Map(sessionRows.filter((r) => r.makeup_class_id && r.makeup_class_name).map((r) => [`${r.student_id}|${r.subject}|${r.makeup_class_id}`, r.makeup_class_name]));
  for (const r of reports) {
    if (!r.makeup_class_id || r.makeup_class_name) continue;
    const name = sessionName.get(`${r.student_id}|${(r.subject ?? "").trim() || LEGACY_REPORT_SUBJECT}|${r.makeup_class_id}`);
    if (name) r.makeup_class_name = name;
  }
  return [...reports, ...sessionRows];
}

/** 맡은 보강 배정을 읽지 못했을 때 화면에 그대로 싣는 안내(원문·코드 없이). */
const MAKEUP_UNREAD_NOTICE = "보강 배정을 확인하지 못했습니다. 새로고침해 다시 확인해 주세요.";

/**
 * **보는 사람**(실제 로그인 계정)의 `users.ui_prefs` — '다른 강사 뷰'에서 표시 취향(글씨 크기 · 표시 옵션 · 영상 마감 내 기본값)만 따로 읽는다.
 * 🔴 그 값들의 저장은 실제 계정에 간다(글씨 크기 `setMyOnescreenFontSize` · 표시 옵션 · 영상 마감 기본값 `patchMyUiPrefs`). 읽기가 대상 강사의
 *    행이면 저장한 값이 화면에 돌아오지 않는다(2026-11-05 강사뷰 신원 적대 리뷰 — ECS `viewer-prefs.ts`와 같은 결정).
 * ⚠️ 반·보고서에 묶인 값(반별 마지막 템플릿 · 학습 추세 미발송 · 멘트 모드)은 여기서 읽지 않는다 — 화면 주인(대상 강사) 것이다.
 */
async function viewerUiPrefs(supabase: Awaited<ReturnType<typeof createClient>>): Promise<unknown> {
  const me = await getCurrentUser();
  if (!me) return null;
  const { data } = await supabase.from("users").select("ui_prefs").eq("id", me.id).maybeSingle();
  return (data as { ui_prefs?: unknown } | null)?.ui_prefs ?? null;
}

function emptyRoster(today: string, date: string, teacherName: string, config: RosterConfig = {}): TeacherRoster {
  return {
    today,
    date,
    classTags: [CLASS_TAG_ALL],
    teacherName,
    students: [],
    todayClasses: [],
    noClassesToday: false,
    showingAll: false,
    allowTeacherTestMax: false,
    showDailyTest: true,
    showCheckTest: true,
    noticeMode: null,
    academyNoticeMode: "A",
    classnoteSendEnabled: false,
    classnoteOn: false,
    sendWindow: null,
    showAttachments: true,
    canEditAttendance: false,
    fontSize: DEFAULT_ONESCREEN_FONT_SIZE,
    displayOptions: DEFAULT_DISPLAY_OPTIONS,
    trendOptOut: [],
    templatePrefs: { last: null, byClass: {} },
    videoDueDefault: "week",
    // 미리보기 재료의 폴백 — 학원설정을 못 읽은 경로(비로그인)에서도 타입이 완전해야 한다.
    // 실제 값은 위 config가 덮는다(학생 0명 로스터도 '보강 학생 추가'로 보고서를 쓰므로 하드코딩 금지).
    reportSettings: DEFAULT_SETTINGS.report,
    academyName: "",
    logoSrc: null,
    holidayName: null,
    ...config,
  };
}

export async function getTeacherRoster(rawDate?: string, showAll = false): Promise<TeacherRoster> {
  // 대상 날짜 = 고른 날짜(YYYY-MM-DD) 클램프(미래·형식오류→오늘). 요일·표시·데이터 앵커를 **모두 이 날짜**로
  // 통일(옛 코드는 요일=서버 로컬 now.getDay(), 데이터=KST kstToday()로 어긋날 수 있었음 — 함께 교정).
  const targetDate = resolveReportDate(rawDate);
  const today = formatKoreanDate(targetDate);
  const dow = DOW_KEY[weekdayIndexOf(targetDate)];

  const user = await getCurrentUser({ teacherView: true });
  if (!user) return emptyRoster(today, targetDate, "");
  // '다른 강사 뷰'(열람 전용, 2026-08-19) — 로스터의 강사 축을 열람 대상으로 통째 전환한다.
  // viewAsTeacher()는 매 요청 자격·대상을 재검증(effectiveTeacherId와 같은 판정)하고, 아니면 본인.
  // 쓰기는 이 축과 무관하게 전부 차단돼 있다(perm-matrix 캡 + 각 액션 readonlyTeacherViewError 가드).
  const viewAs = await viewAsTeacher();
  const teacherId = viewAs?.id ?? user.id;
  const teacherName = viewAs?.displayName ?? user.displayName ?? "";

  const supabase = await createClient();
  // ECS 시트 표(`class_sheet_*`)는 RLS 정책이 없어 사용자 클라이언트로는 못 읽는다 — 그 조회에만 쓴다.
  const admin = createAdminClient();
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gradeOrder = settings.operations.gradeLevels;
  // 과목별 테스트 문항수(만점) — 원스크린 점수 입력 /N 기본값. 미설정 과목은 5.
  const subjectTestMax = new Map(settings.operations.subjects.map((su) => [su.key, su.testMax ?? 5]));
  const allowTeacherTestMax = settings.report.allowTeacherTestMax;
  const { showDailyTest, showCheckTest } = settings.report;
  const academyNoticeMode: "A" | "B" = settings.report.noticeMode ?? "A";

  // 1) 그 날짜에 내가 가르치는 활성 반(담당 반 ∪ **위임받은 반**, 0173a) + 본인 멘트 모드
  //    + 학생 표시 순서(0116a, 강사×반 개인 설정) + 출결 쓰기 권한 — 서로 독립이라 병렬(B4).
  //    ⚠️ `classes.teacher_id`를 여기서 직접 비교하지 말 것 — 판정은 getTeachingClasses 단일 소스다
  //    (저장·발송·출결 게이트가 같은 함수를 쓴다. 갈라지면 "화면엔 뜨는데 저장하면 거절"이 난다).
  const [teachingClasses, { data: meRow }, { data: orderRows }, canEditAttendance, logoSrc, holidayName, viewerPrefs] =
    await Promise.all([
      getTeachingClasses(supabase, teacherId, targetDate),
      // 멘트 모드 · 반별 템플릿 · 학습 추세 미발송은 화면 주인(대상 강사)의 반·보고서에 묶인 값 — 대상 행에서 읽는다.
      supabase.from("users").select("report_notice_mode, ui_prefs").eq("id", teacherId).single(),
      supabase.from("onescreen_student_order").select("class_id, student_ids").eq("teacher_id", teacherId),
      canWriteTenant(user.systemRole, "attendance"),
      // 학부모 보고서 미리보기의 로고 — /r·인쇄와 **같은 해석기**를 쓴다(미리보기가 발송본과 달라지지 않게).
      // 로고를 안 쓰는 설정이면 서명 왕복 자체를 건너뛴다(원스크린은 전원이 매일 여는 경로 — 왕복 하나가 비싸다).
      settings.report.showLogo
        ? resolveBrandingSrc(reportLogoPath(settings), user.tenantId).catch(() => null)
        : Promise.resolve(null),
      // 휴원일 이름 — 위에서 읽은 학원설정을 그대로 읽는다(요청 단위 캐시라 왕복 0). 실패는 null(fail-soft).
      holidayNameOrNull(targetDate),
      // 표시 취향은 보는 사람(실제 계정) 것 — '다른 강사 뷰'일 때만 따로 읽는다(아니면 위 행이 곧 내 행이라 왕복 0).
      viewAs ? viewerUiPrefs(supabase) : Promise.resolve(undefined),
    ]);
  const orderByClass = new Map(
    (orderRows ?? []).map((r) => [r.class_id as string, (r.student_ids ?? []) as string[]]),
  );
  const noticeMode = ((meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? null);
  // 🔑 표시 취향 = 보는 사람 행(viewerUiPrefs) · 반/보고서에 묶인 값 = 화면 주인 행(meRow) — 나눔은 pref-owner.ts 한 벌.
  const { fontSize, displayOptions, trendOptOut, templatePrefs, videoDueDefault } = splitOnescreenPrefs({
    viewingOtherTeacher: !!viewAs,
    ownerPrefs: meRow?.ui_prefs,
    viewerPrefs,
  });

  // 학원설정·강사설정에서 온 값 — 빈 로스터를 포함해 **모든 반환 경로가 이걸 그대로 쓴다**(emptyRoster 주석 참조).
  const config: RosterSettings = {
    allowTeacherTestMax,
    showDailyTest,
    showCheckTest,
    noticeMode,
    academyNoticeMode,
    classnoteSendEnabled: classnoteSendOn(settings),
    classnoteOn: classnoteModuleOn(settings),
    // 활성(둘 다 유효 HH:MM + 시작≠종료)일 때만 원문을 내린다 — 비활성이면 클라 배너 컴포넌트 자체가 안 뜬다.
    sendWindow: classnoteSendWindowLabel(
      settings.report.classnoteSendWindowStart,
      settings.report.classnoteSendWindowEnd,
    )
      ? {
          start: settings.report.classnoteSendWindowStart.trim(),
          end: settings.report.classnoteSendWindowEnd.trim(),
        }
      : null,
    showAttachments: settings.report.showAttachments,
    canEditAttendance,
    fontSize,
    displayOptions,
    trendOptOut,
    templatePrefs,
    videoDueDefault,
    // 카드 뷰 '학부모 미리보기'(2026-08-05) — /r·인쇄와 **같은 컴포넌트**(ParentReportCard)에 넘길 재료.
    // 표시 토글까지 그대로 실어야 미리보기가 발송본과 같은 것을 보여준다(토글 off 항목은 미리보기에도 안 뜬다).
    reportSettings: settings.report,
    academyName: settings.profile.name || "",
    logoSrc,
    holidayName,
  };

  // 아래 로직은 전부 DB 컬럼 이름(class_name/is_special)을 쓰던 코드라 여기서 한 번만 맞춘다.
  // delegated/ownerName은 반 칩이 '내 반'과 위임 반을 시각적으로 가르는 데 쓴다(원장 지시 2026-08-03).
  // 🔴 '수업보고서 미발송' 반(0174a)은 **목록에서 빼지 않는다**(2026-08-19 원장: *"보고서는 안보내지만
  //    이제부터라도 출결은 찍을것"*). 예전엔 여기서 `.filter((c) => !c.reportOptout)`로 통째로 뺐는데,
  //    원스크린이 **출결 알약이 있는 유일한 강사 화면**이라 그 필터가 곧 "담임이 출결을 찍을 수단 0"이었다
  //    (실측 2026-08-19: 미발송 3반 전부 출결 0행 · 수업은 실제로 돌고 있었다).
  //    대신 **행에 플래그를 실어**(`reportOptout`) 보고서 칸만 잠근다 — 판정은 grid.ts 단일 소스.
  //
  //    ⚠️ **옛 경고("필터를 noClassesToday 뒤로 옮기지 말 것", 2026-07-22 이수진 회귀)는 그대로 유효하다.**
  //       그 회귀는 "제외 반만 있는 날"이 수업 없음으로 읽혀 **담당 반 전체 폴백**이 살아나는 것이었다.
  //       필터를 **없앤** 지금은 미발송 반이 `todayIds`에 정상으로 들어가 `noClassesToday=false`가 되고,
  //       폴백 분기(`showAll`)는 애초에 타지 않는다 — 화면에는 **그날 수업이 있는 그 반만** 뜬다.
  //       즉 "미발송 반만 있는 날"이 이제 수업 있음으로 읽히는데, **그게 맞다**(출결을 찍어야 하니까).
  const allClasses = teachingClasses.map((c) => ({
    id: c.id,
    class_name: c.className,
    subject: c.subject,
    is_special: c.isSpecial,
    // 보고서 쪽만 잠그는 근거 — 목록에서 빼는 데는 쓰지 않는다(위 주석).
    report_optout: c.reportOptout,
    delegated: c.delegated,
    jjReport: c.jjReport === true,
    ownerName: c.ownerName,
    delegatedAwayTo: c.delegatedAwayTo,
  }));
  // 2) 오늘 요일에 수업 있는 반(없으면 전체 담당 반 폴백 — 주말/휴일에도 화면이 비지 않게)
  const allIds = allClasses.map((c) => c.id);
  // ⚠️ **그 날짜에 유효한 스케줄만**. 예전엔 valid_from/valid_to를 안 봐서 만료된 배치가 계속 "오늘 수업"으로
  //    잡혔다 — 특강처럼 기간이 정해진 반(실측: 특강 4반 전부 valid_to 08-07~08-31, 수강행은 대부분 무기한)이
  //    종료일 뒤에도 로스터에 영원히 남는다. 시간표(fetchSlots)와 같은 규약으로 맞춘다.
  // ⚠️ 보강 보고서 조회는 반과 무관하다 — 스케줄과 **병렬**로(B4: 독립 await는 Promise.all).
  //    그날 내가 쓴 보강(수업외) 보고서 = 아래 수강생 로스터엔 절대 안 잡히는 행들의 유일한 원천.
  // 🔴 던지지 않게 받는다 — 아래 '빈 명단' 반환보다 **먼저** 읽어야 해서(맡은 보강 학생만 있는 날), 실패가 수업 없는 강사의
  //    화면까지 죽이면 안 된다. 실패는 결과로 들고 가서, 빈 명단엔 알림으로 싣고 명단을 합칠 땐 종전대로 던진다.
  const nativePromise = loadNativeParticipants({ session_date: targetDate, limit: 500 }, { sharedRead: true }).catch(
    (): ReadOutcome<ParticipantRead> => ({ status: "failed", error: MAKEUP_UNREAD_NOTICE }),
  );
  const [scheds, makeupReports, makeupAttRows, reservationsToday, splitsToday] = await Promise.all([
    // end_time·자리 라벨·유효구간·요일은 **수학 자동 시수**(수업 길이, auto-units.ts) 재료 — 같은 행이라 왕복 0.
    fetchInChunks<{
      class_id: string;
      start_time: string;
      end_time: string;
      day_of_week: string;
      valid_from: string;
      valid_to: string | null;
      slot_teacher_label: string | null;
    }>(allIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, start_time, end_time, day_of_week, valid_from, valid_to, slot_teacher_label")
        .eq("day_of_week", dow)
        .in("class_id", chunk)
        .or(`valid_from.is.null,valid_from.lte.${targetDate}`)
        .or(`valid_to.is.null,valid_to.gte.${targetDate}`),
    ),
    fetchMyMakeupReports(supabase, user.tenantId, targetDate, teacherId, teacherName),
    // 🔴 그날 **내 반에 찍힌 보강 출결** — 보고서가 아직 없어도 화면에 남아야 한다(원장 제보 2026-09-05
    //    *"오늘자 주준호를 추가하려고 하니까 새로고침할 때마다 사라짐"*).
    //    실측: 허주연 담당 반은 월~금만 도는데 토요일에 `중등M 개별 BS3Q`로 보강 2건(주준호·최하림)을
    //    찍었다. 그 반은 '오늘의 반'이 아니라 아래 `activeIds`에서 빠지고, 보강 행을 되살리는 5-c가
    //    activeIds만 보고 있어 **새로고침마다 통째로 사라졌다**(저장은 됐는데 보이지 않는 데이터).
    //    ⚠️ 반 축이다(`class_id in 내 담당 반`) — `recorded_by`는 귀속이 아니다(teacher-axis.ts).
    fetchInChunks<{ student_id: string; class_id: string }>(allIds, (chunk) =>
      supabase
        .from("attendance_records")
        .select("student_id, class_id")
        .eq("session_date", targetDate)
        .eq("status", "makeup")
        .in("class_id", chunk),
    ),
    // 🔴 그날 **내 반에 예약된 보강**(0264a) — 아직 출결도 보고서도 없지만 오기로 한 학생이라 미리 선다(원장 2026-09-14
    //    *"보강 추가 할 필요없이 미리 학생이 추가되어있어야"*). 조회는 **별도 함수 + fail-soft**(표가 없어도 빈 목록) —
    //    이 로스터는 강사 전원의 hot path라 새 컬럼·표를 본문 select에 섞지 않는다([[#95]]).
    getRosterReservationsOn(targetDate, allIds),
    // 🔴 그날 내 반이 **보내거나 받는 수업 나누기**(0351a) — 받는 반엔 그 학생이 미리 서고(출결은 이 반 몫), 원래 반 행엔
    //    표식이 붙는다. 조회는 별도 함수 + fail-soft(표가 없어도 빈 결과 — 이 로스터는 강사 전원의 hot path, [[#95]]).
    getSplitsOnDate(targetDate, allIds),
  ]);
  // 아직 안 한 예약 — 미리 세우기·"보강만 있는 날" 판정은 종전대로 이것만 본다(이행분은 출결·보고서가 줄을 되살린다).
  const reservedToday = reservationsToday.filter((r) => r.status === "reserved");
  /**
   * **내가 맡은 보강 회차의 학생**(보강관리 배정) — 원반 담임·위임이 아니어도, 담당 반이 하나도 없어도 이 화면에 서야 한다.
   * 예전엔 아래 두 '빈 명단' 반환이 이 조회를 보기도 전에 끝났다(배정은 됐는데 기록 화면에 학생이 없다).
   * 조회는 위에서 이미 떠 있어 왕복이 늘지 않는다. 강사 축은 `teacherId`(다른 강사 뷰면 그 강사).
   */
  const nativeOutcome = await nativePromise;
  const nativeUnread = nativeOutcome.status === "failed" || (nativeOutcome.status === "ok" && nativeOutcome.value.truncated);
  const conducted = conductedPairs(nativeOutcome.status === "ok" && !nativeUnread ? nativeOutcome.value.participants : [], teacherId);
  // 못 읽은 날의 빈 명단은 그 사실을 싣는다 — "맡은 학생 없음"과 "확인하지 못함"은 다른 말이다.
  const emptyConfig: RosterConfig = nativeUnread ? { ...config, makeupNotice: MAKEUP_UNREAD_NOTICE } : config;
  if (
    allClasses.length === 0 &&
    makeupReports.length === 0 &&
    makeupAttRows.length === 0 &&
    reservedToday.length === 0 &&
    conducted.length === 0
  )
    return emptyRoster(today, targetDate, teacherName, emptyConfig);
  const todayIds = new Set(scheds.map((s) => s.class_id));
  // 반별 오늘 최초 시작시각(HH:MM)
  const endByClass = lessonEndsByClass(scheds);
  const startByClass = new Map<string, string | null>();
  for (const s of scheds) {
    const t = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = startByClass.get(s.class_id);
    if (prev === undefined) startByClass.set(s.class_id, t);
    else if (t && (prev === null || t < prev)) startByClass.set(s.class_id, t);
  }
  // 수학 자동 시수(수업 길이 → 시수, 원장 2026-09-11) — 출결을 **처음** 찍을 때 서버가 넣는 값과 같은 함수로
  // 반마다 그날 값을 접는다. '타임' 칸이 기록 없는 행에서 이 값을 보여 준다(보이는 기본값 = 저장될 값).
  const autoUnitsByClass = new Map<string, number>();
  {
    const schedsByClass = new Map<string, ReturnType<typeof toAutoUnitsSchedule>[]>();
    for (const s of scheds) {
      const list = schedsByClass.get(s.class_id) ?? [];
      list.push(toAutoUnitsSchedule(s));
      schedsByClass.set(s.class_id, list);
    }
    // 새 학원(일반판)은 자동 시수가 없다 — 저장(resolveAutoUnits)과 같은 프로필(요청 캐시). 침산은 종전과 같다.
    const autoUnitsOnForTenant = (await getLessonProfile()).autoUnits;
    for (const c of allClasses) {
      if (!autoUnitsOnForTenant || !isAutoUnitsSubject(c.subject)) continue;
      const u = autoUnitsOn(targetDate, schedsByClass.get(c.id) ?? []);
      if (u !== null) autoUnitsByClass.set(c.id, u);
    }
  }
  // ⚠️ 그 요일에 수업이 없으면 **비운다** — 옛 코드는 담당 반 전체로 조용히 폴백해, 수요일 수업이 없는
  // 강사에게 담당 반 7개·학생 37명을 "오늘 목록"처럼 보여줬다(2026-07-22 이수진 사례, 타입 주석 참조).
  // 전체 보기는 남기되 **강사가 명시로 고를 때만**(showAll) — 그때는 화면이 "전체 보기 중"임을 밝힌다.
  // ⚠️ 빈 목록이어도 학원설정(config)은 그대로 실어 보낸다 — 이 화면에서도 '+ 보강 학생 추가'로 발송이 가능하다.
  // JJ 보고서 담당 반 — 그날 수업이 없어도 늘 세운다(원장 2026-10-28 *"일주일에 한번 보내거나 … 수업이 없어도 떠야함"*, delegation.ts).
  const jjIds = new Set(allClasses.filter((c) => c.jjReport).map((c) => c.id));
  const noClassesToday = todayIds.size === 0 && jjIds.size === 0;
  // 🔴 그날 보강 기록이 있으면 "수업 없음"이어도 화면을 비우지 않는다 — 보강만 있는 날엔 그게 유일한 기록이고,
  //    비우면 강사가 방금 발송한 보고서를 찾을 길이 사라진다(원장 2026-08-03). 단 **담당반 전체 폴백은
  //    여전히 금지**(2026-07-22 회귀 방지) — 반 목록은 비우고 보강 행만 싣는다.
  // ⚠️ 보강 **출결**도 보고서와 같이 센다 — 출결만 찍고 보고서는 아직 안 쓴 상태가 정상 순서다
  //    (강사는 학생이 오면 먼저 출결을 찍는다). 보고서만 세면 그 사이 화면이 비어 방금 넣은 학생이 사라진다.
  // 보강 예약(0264a)도 같이 센다 — 토요일에 잡힌 보강처럼 "수업 없는 날의 예약"이 이 화면의 유일한 할 일일 수 있다.
  if (
    noClassesToday &&
    !showAll &&
    makeupReports.length === 0 &&
    makeupAttRows.length === 0 &&
    reservedToday.length === 0 &&
    conducted.length === 0
  ) {
    return emptyRoster(today, targetDate, teacherName, { ...emptyConfig, noClassesToday: true });
  }
  const activeClasses = noClassesToday
    ? showAll
      ? allClasses
      : []
    : allClasses.filter((c) => todayIds.has(c.id) || jjIds.has(c.id));
  const classById = new Map(activeClasses.map((c) => [c.id, c]));
  const activeIds = activeClasses.map((c) => c.id);
  // EiE 월간 보고서 점수(2026-11-05) — 영어 반만, 본 로스터 조회와 **나란히**(B4) 돌리고 아래에서 행에 싣는다.
  // 실패·영역 칸 미적용이면 빈 결과(원스크린은 그대로 뜬다 — english-monthly.ts).
  const englishClassIds = activeClasses.filter((c) => c.subject === "english").map((c) => c.id);
  const monthlyEvalsP = loadEnglishMonthlyEvals(user.tenantId, englishClassIds, targetDate);
  // 그 달 숙제·태도·단어 테스트(원장 2026-11-06, EiE 반만) — 같은 달을 쓰려고 점수의 달을 받아 고른다. 실패면 빈 결과.
  const monthlyActivitiesP = loadEnglishMonthlyActivities(
    user.tenantId,
    englishClassIds,
    targetDate,
    monthlyEvalsP.then((evals) => (key: string) => evals.get(key)?.month),
  );

  // 3) 대상 날짜 시점 수강생 — start≤date AND (end null OR end≥date). null 양단 허용(레거시 안전).
  // ⚠️ end_date IS NULL 고정이면 과거 날짜 마감 시 그새 종료된 학생이 누락되고, 출결 write 게이트(날짜기준)와
  //    어긋나 pill 클릭이 거부된다(회귀). 출석부·setAttendanceCell과 같은 날짜 기준으로 통일.
  // 날짜창은 DB에서 좁히고, 분리등원·휴원·반이동 규약은 rosterIncludesEnrollment(eligibility 단일소스)로 판정.
  const enrollmentRows = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string | null;
    end_date: string | null;
    on_hold: boolean | null;
    is_transferred: boolean | null;
    attendance_days: string[] | null;
  }>(activeIds, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
      .or(`start_date.is.null,start_date.lte.${targetDate}`)
      .or(`end_date.is.null,end_date.gte.${targetDate}`)
      .in("class_id", chunk),
  );
  // 그 요일에 안 오는 학생(분리등원)·휴원은 제외 — 폴백(요일 수업 없음)일 땐 요일 조건 미적용.
  const enrollments = enrollmentRows.filter((e) =>
    // JJ 담당 반은 등원 요일로 거르지 않는다(수업 없는 날에도 반 전원 — 보고서는 주 단위로 쓴다).
    rosterIncludesEnrollment(e, targetDate, dow, todayIds.size > 0 && !jjIds.has(e.class_id)),
  );
  // 결정적 정렬(반 시작시각→class_id) — '대표 반'(tag=첫 반)·과목 행 순서를 새로고침 간 안정화(비결정 방지).
  enrollments.sort(
    (a, b) =>
      (startByClass.get(a.class_id) ?? "99:99").localeCompare(startByClass.get(b.class_id) ?? "99:99") ||
      a.class_id.localeCompare(b.class_id),
  );
  // 출석부가 연 보강 칸 — 보고서보다 출결이 먼저인 경우(ECS·출석부에서 추가)도 원스크린에 되살린다.
  const classAttRows = await fetchInChunks<{ student_id: string; class_id: string }>(activeIds, (chunk) =>
    supabase
      .from("attendance_records")
      .select("student_id, class_id")
      .eq("session_date", targetDate)
      .in("class_id", chunk),
  );
  const attMakeup: { studentId: string; classId: string }[] = [];
  for (const classId of activeIds) {
    const enrolled = enrollments.filter((e) => e.class_id === classId).map((e) => e.student_id);
    const recorded = classAttRows.filter((r) => r.class_id === classId).map((r) => r.student_id);
    for (const id of makeupStudentIds(recorded, enrolled)) attMakeup.push({ studentId: id, classId });
  }
  /**
   * **오늘의 반이 아닌 반**에 찍힌 보강 — 위 루프는 `activeIds`만 돌아서 이 행들을 아예 안 본다.
   *
   * 🔴 **그 학생만 되살린다. 반을 `activeIds`에 넣지 않는다** — 넣으면 `enrollments`가 그 반 전체로
   *    넓어져 토요일에 반 전원이 뜬다(2026-07-22 "담당반 전체 폴백 금지" 회귀). 아래 `classById`에만
   *    넣어 5-c가 반 이름·과목을 찾을 수 있게 한다(맵은 조회 전용이라 명단을 넓히지 않는다).
   * 🔴 `makeupStudentIds`를 여기 태우지 않는다 — 그 함수는 "수강생이면 정규 명단에 뜬다"를 전제로
   *    수강생을 빼는데, 그 반이 오늘 안 도는 날엔 정규 명단 자체가 없다. 실제로 주준호·최하림은 둘 다
   *    BS3Q 수강생이라 그 전제에 걸려 **양쪽 어디에도 못 서고 사라졌다.** 보강 기록이 곧 "왔다"는 증거다.
   */
  const activeIdSet = new Set(activeIds);
  const rescueSeen = new Set<string>();
  for (const r of makeupAttRows) {
    if (activeIdSet.has(r.class_id)) continue;
    const key = `${r.student_id}|${r.class_id}`;
    if (rescueSeen.has(key)) continue;
    rescueSeen.add(key);
    attMakeup.push({ studentId: r.student_id, classId: r.class_id });
    const cls = allClasses.find((c) => c.id === r.class_id);
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }
  /**
   * **보강 예약된 학생**(0264a) — 출결 행과 같은 자리(보강 행)로 미리 세운다.
   * · 오늘 도는 반의 예약: 그 반 수강생이면 정규 명단에 이미 있다(안 더한다) / 아니면 보강 행.
   * · 오늘 안 도는 반의 예약(토요일 보강 등): 위 되살리기와 같은 규칙 — **학생만** 더하고 반은 `activeIds`에 안 넣는다.
   * 이미 출결·보고서로 선 학생은 중복해 세우지 않는다(`attMakeup`·`makeupReports`가 먼저다).
   */
  const alreadyMakeup = new Set(attMakeup.map((m) => `${m.studentId}|${m.classId}`));
  const enrolledKey = new Set(enrollments.map((e) => `${e.student_id}|${e.class_id}`));
  // 정규 수업일 예약 = '+ 보강 학생 추가'의 합침/분리(원장 2026-10-22). 합침은 정규 줄 하나(아래 세션 복원 뒤 표식·'정규+보강'),
  // 분리는 정규 줄과 따로 '(보강)' 줄 — 이행(출석을 찍음) 뒤에도 보고서를 쓸 때까지 서 있어야 해서 이행분까지 본다.
  const reservedPlan = planReservedMakeup(reservationsToday, enrolledKey);
  const separateRegular = new Set(reservedPlan.separate.map((s) => `${s.studentId}|${s.classId}`));
  for (const r of reservationsToday) {
    const key = `${r.studentId}|${r.classId}`;
    const splitOff = separateRegular.has(key);
    if (r.status !== "reserved" && !splitOff) continue;
    if (alreadyMakeup.has(key) || (enrolledKey.has(key) && !splitOff)) continue;
    if (makeupReports.some((m) => m.student_id === r.studentId)) continue;
    alreadyMakeup.add(key);
    attMakeup.push({ studentId: r.studentId, classId: r.classId });
    const cls = allClasses.find((c) => c.id === r.classId);
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }
  /**
   * **보강관리의 참여** — 내 담당 반의 참여(종전) ∪ **내가 맡은 회차의 참여**(반이 내 반이 아니어도, `rosterNativePairs`).
   * 🔴 남의 반은 **그 학생만** 세운다. 반을 `activeIds`·`allClasses`에 넣지 않는다(위 되살리기와 같은 규칙 — 넣으면 그 반 전원이 뜬다).
   *    이름·과목만 따로 읽어 `classById`(조회 전용)에 둔다. 남의 반의 다른 참여는 이름을 알아도 세우지 않는다.
   * 🔴 저장 관문은 건드리지 않는다: 그 반의 출결 칸을 직접 쓰는 길은 종전대로 담당 반만이고(`setAttendanceCell`), 맡은 강사의 칸은
   *    보강 보고서 저장이 세운다(`syncAnchorCells` — 귀속 = 보강한 강사). 이 행은 기존 보강 행처럼 `classId=null`이라 직접 출결 조작이 없다.
   */
  /**
   * **수업 나누기로 오늘 내 반에 오는 학생**(0351a) — 오늘 도는 반(`activeIds`)에서만. 이미 그 반 수강생이면 정규 행이 있다(안 더한다).
   * 행은 아래 5-d가 `classId`가 있는 행으로 세운다(출결 알약이 그 반에 찍힌다) + 보고서는 잠근다(`reportOptout`).
   */
  const splitPlan = planSplitRows(activeIds, targetDate, splitsToday.splits, splitsToday.classNames, enrolledKey);
  const ownClassIds = new Set(allIds);
  const nativePairs = rosterNativePairs(alreadyMakeup, participantsOrLegacy(nativeOutcome), teacherId, ownClassIds);
  const foreignIds = foreignClassIds(nativePairs.filter((pair) => pair.foreign), ownClassIds);
  let makeupNotice: string | null = null;
  let foreignClasses: (typeof allClasses)[number][] = [];
  if (foreignIds.length > 0) {
    // 평소엔 0건이라 왕복이 없다(맡은 남의 반 보강이 있는 날에만 한 번). 실패는 그 학생만 빼고 알린다 — 명단 전체를 죽이지 않는다.
    try {
      const rows = await fetchInChunks<{ id: string; class_name: string; subject: string }>(foreignIds, (chunk) =>
        supabase.from("classes").select("id, class_name, subject").eq("tenant_id", user.tenantId).in("id", chunk),
      );
      foreignClasses = rows.map((c) => ({
        id: c.id, class_name: c.class_name, subject: c.subject, is_special: false, report_optout: false,
        delegated: false, jjReport: false, ownerName: null, delegatedAwayTo: null,
      }));
    } catch {
      makeupNotice = MAKEUP_UNREAD_NOTICE;
    }
  }
  const foreignById = new Map(foreignClasses.map((c) => [c.id, c]));
  for (const row of nativePairs) {
    const key = `${row.studentId}|${row.classId}`;
    const cls = row.foreign ? foreignById.get(row.classId) : allClasses.find((c) => c.id === row.classId);
    if (row.foreign && !cls) {
      // 반 이름을 못 읽었다(조회 실패 · 지워진 반) — 그 학생은 세우지 못하니 그 사실을 알린다.
      makeupNotice = MAKEUP_UNREAD_NOTICE;
      continue;
    }
    alreadyMakeup.add(key);
    attMakeup.push({ studentId: row.studentId, classId: row.classId });
    if (cls && !classById.has(cls.id)) classById.set(cls.id, cls);
  }

  // 보강 학생은 수강생이 아니어도 화면에 있어야 한다 — 아래 학생정보·보고서 조회가 이 id 집합을 쓴다.
  const studentIds = [
    ...new Set([
      ...enrollments.map((e) => e.student_id),
      ...makeupReports.map((r) => r.student_id),
      ...attMakeup.map((r) => r.studentId),
      ...splitPlan.incoming.map((r) => r.studentId),
    ]),
  ];
  if (studentIds.length === 0)
    return emptyRoster(today, targetDate, teacherName, {
      ...config,
      ...(makeupNotice ? { makeupNotice } : {}),
      noClassesToday,
      showingAll: noClassesToday && showAll,
    });

  // 4) 학생 기본 정보
  // school = 학부모 보고서 미리보기의 "학교 · 학년" 한 줄용(발송본 /r과 같은 표기 — fmtSchoolGrade).
  const studentRows = await fetchInChunks<{
    id: string;
    name: string;
    grade: string | null;
    school: string | null;
  }>(studentIds, (chunk) => supabase.from("students").select("id, name, grade, school").in("id", chunk));
  const studById = new Map(studentRows.map((s) => [s.id, s]));

  // 5) 학생별 OneScreenStudent — 과목 = 그 학생이 듣는 (강사 담당) 반의 과목들
  const byStudent = new Map<string, OneScreenStudent>();
  // 반 필터용 tags = 학생의 **수강 반 이름 전체**(enrollments 기준). ⚠️ subjects의 className에서 도출하면
  //   같은 과목 두 반(dedup으로 className=null)인 학생이 그 반 필터에서 통째 누락된다(F4 후속 회귀) → enrollments로 도출.
  const classNamesByStudent = new Map<string, Set<string>>();
  for (const e of enrollments) {
    const stu = studById.get(e.student_id);
    const cls = classById.get(e.class_id);
    if (!stu || !cls) continue;
    const set = classNamesByStudent.get(stu.id) ?? new Set<string>();
    set.add(cls.class_name);
    classNamesByStudent.set(stu.id, set);
    const grade = stu.grade ?? "";
    // 테스트 만점 = 이 학생 (첫) 과목의 문항수 설정. 세션에 저장된 값이 있으면 아래에서 덮어씀.
    const tmax = subjectTestMax.get(cls.subject) ?? 5;
    let os = byStudent.get(stu.id);
    if (!os) {
      os = {
        id: stu.id,
        name: stu.name,
        grade,
        school: stu.school ?? "",
        tag: cls.class_name, // 반별 필터(반 이름 기준)
        className: cls.class_name,
        classId: cls.id,
        attendance: "출석",
        subjects: [],
        tests: {
          // 문항수는 과목 설정값으로 시드 — 아래 승계(권한 on)·세션복원이 있으면 덮어쓴다.
          daily: { score: null, max: tmax, prevScore: null },
          check: { score: null, max: tmax, prevScore: null },
        },
        attitude: null,
        homework: "",
        note: "",
        progressConfirmed: false,
        reportDraft: "",
        reportSent: false,
      };
      byStudent.set(stu.id, os);
    }
    // 🔴 행 단위 = **반**(0134a). 예전엔 subjectKey로 dedup해 같은 과목 두 반을 한 행으로 합치고 classId를
    //    지웠다 → ① 정규 수학 + 수학 특강을 같은 날 들어도 보고서를 1건밖에 못 썼고(원장 요구 "수업마다 1건씩"에
    //    정면 위배) ② 반이 모호해져 출결 pill이 통째로 사라졌다. 이제 반마다 한 행을 만든다.
    //    같은 반이 두 번 들어오는 경우(중복 enrollment)만 합친다.
    if (!os.subjects.some((su) => su.classId === cls.id)) {
      // classId = 이 과목 행의 반(출결 원장이 student+class+date라 행 단위 출결 입력(2단계)의 키).
      // subjectLabel = 순수 과목명 — name은 아래에서 반 이름이 덧붙을 수 있으므로 저장용 값은 이쪽을 쓴다.
      const label = subjects.labelOf(cls.subject);
      // ⚠️ `reportOptout`은 **true일 때만** 싣는다 — 로스터 payload는 전 강사가 매일 받는 hot path라
      //    모든 행에 false를 얹지 않는다(판정 `isReportOptoutRow`가 `=== true`라 없으면 = 정상 반).
      os.subjects.push({ name: label, subjectLabel: label, subjectKey: cls.subject, classId: cls.id, className: cls.class_name, isSpecial: !!cls.is_special, ...(cls.report_optout ? { reportOptout: true } : {}), prev: "", today: "", textbook: "", makeup: false, homeworkToday: "" });
    }
  }
  // 5-b) 보강(수업외) 행 복원 — DB의 그날 보강 보고서가 원천. 카드가 있으면 행만 덧붙이고, 없으면 보강 카드로.
  // ⚠️ 여기서 만든 행은 `classId=null·makeup=true`라 정규 행과 저장 단위(unit_key)가 분리된다(0134a).
  //    행 이름에 "(보강)"을 붙여 정규 행과 화면 state 키가 겹치지 않게 한다(아래 유일화가 한 번 더 보장).
  if (makeupReports.length) {
    const classNameById = new Map([...allClasses, ...foreignClasses].map((c) => [c.id, c.class_name]));
    for (const mr of makeupReports) {
      const stu = studById.get(mr.student_id);
      if (!stu) continue; // 학생 조회 실패(삭제 등) — 행을 만들 수 없다
      const key = (mr.subject ?? "").trim() || LEGACY_REPORT_SUBJECT;
      const label = subjects.labelOf(key);
      const anchorName = mr.makeup_class_id ? (classNameById.get(mr.makeup_class_id) ?? mr.makeup_class_name ?? null) : null;
      let os = byStudent.get(stu.id);
      if (!os) {
        const tmax = subjectTestMax.get(key) ?? 5;
        os = {
          id: stu.id,
          name: stu.name,
          grade: stu.grade ?? "",
          // 앵커가 있으면 그 수업으로 묶어 보여 준다(사이드바 그룹·반 필터). 없으면 "보강".
          tag: anchorName ?? "보강",
          className: anchorName ?? "보강",
          isMakeup: true,
          attendance: "출석",
          subjects: [],
          tests: {
            daily: { score: null, max: tmax, prevScore: null },
            check: { score: null, max: tmax, prevScore: null },
          },
          attitude: null,
          homework: "",
          note: "",
          progressConfirmed: false,
          reportDraft: "",
          reportSent: false,
        };
        byStudent.set(stu.id, os);
      }
      // 같은 과목 보강 행이 이미 있으면(중복 행) 건너뛴다 — 보고서는 unit_key로 과목당 1건이라 정상 경로엔 없다.
      if (os.subjects.some((su) => su.makeup && !su.classId && (su.subjectKey ?? "") === key)) continue;
      os.subjects.push({
        name: `${label} (보강)`,
        subjectLabel: label,
        subjectKey: key,
        classId: null,
        makeup: true,
        makeupClassId: mr.makeup_class_id,
        makeupClassName: anchorName,
        prev: "",
        today: "",
        textbook: "",
        homeworkToday: "",
      });
    }
  }

  // 5-c) 출석부·ECS가 연 보강 칸 — 보고서가 아직 없어도 같은 보강 행으로 되살린다.
  // 5-b가 이미 같은 과목 보강 행을 만들었으면 건너뛴다(보고서가 진실, 출결은 소속만 알려 준다).
  if (attMakeup.length) {
    const classNameById = new Map(allClasses.map((c) => [c.id, c.class_name]));
    for (const row of attMakeup) {
      const stu = studById.get(row.studentId);
      const cls = classById.get(row.classId);
      if (!stu || !cls) continue;
      const key = cls.subject;
      const label = subjects.labelOf(key);
      const anchorName = classNameById.get(row.classId) ?? cls.class_name;
      let os = byStudent.get(stu.id);
      if (!os) {
        const tmax = subjectTestMax.get(key) ?? 5;
        os = {
          id: stu.id,
          name: stu.name,
          grade: stu.grade ?? "",
          tag: anchorName,
          className: anchorName,
          isMakeup: true,
          attendance: "출석",
          subjects: [],
          tests: {
            daily: { score: null, max: tmax, prevScore: null },
            check: { score: null, max: tmax, prevScore: null },
          },
          attitude: null,
          homework: "",
          note: "",
          progressConfirmed: false,
          reportDraft: "",
          reportSent: false,
        };
        byStudent.set(stu.id, os);
      }
      if (os.subjects.some((su) => su.makeup && !su.classId && (su.subjectKey ?? "") === key)) continue;
      os.subjects.push({
        name: `${label} (보강)`,
        subjectLabel: label,
        subjectKey: key,
        classId: null,
        makeup: true,
        makeupClassId: row.classId,
        makeupClassName: anchorName,
        prev: "",
        today: "",
        textbook: "",
        homeworkToday: "",
      });
    }
  }

  // 5-d) 수업 나누기(0351a) — 받는 반 행(출결 알약 O · 보고서 잠금) + 원래 반 행 표식.
  // 🔴 받는 반 행은 `classId`가 있는 **정규 모양**이다(보강 행이 아니다) — 출결이 이 반에 찍혀야 받는 선생님 몫이 된다.
  //    수강행이 없으니 보고서 쪽은 `reportOptout: true`로 잠근다(보고서는 원래 반 담임이 쓴다 — 원장 2026-10-06).
  for (const row of splitPlan.incoming) {
    const stu = studById.get(row.studentId);
    const cls = classById.get(row.classId);
    if (!stu || !cls) continue;
    const label = subjects.labelOf(cls.subject);
    let os = byStudent.get(stu.id);
    if (!os) {
      const tmax = subjectTestMax.get(cls.subject) ?? 5;
      os = {
        id: stu.id,
        name: stu.name,
        grade: stu.grade ?? "",
        school: stu.school ?? "",
        tag: cls.class_name,
        className: cls.class_name,
        classId: cls.id,
        attendance: "출석",
        subjects: [],
        tests: {
          daily: { score: null, max: tmax, prevScore: null },
          check: { score: null, max: tmax, prevScore: null },
        },
        attitude: null,
        homework: "",
        note: "",
        progressConfirmed: false,
        reportDraft: "",
        reportSent: false,
      };
      byStudent.set(stu.id, os);
    }
    const names = classNamesByStudent.get(stu.id) ?? new Set<string>();
    names.add(cls.class_name);
    classNamesByStudent.set(stu.id, names);
    if (os.subjects.some((su) => su.classId === cls.id)) continue;
    os.subjects.push({
      name: label,
      subjectLabel: label,
      subjectKey: cls.subject,
      classId: cls.id,
      className: cls.class_name,
      isSpecial: !!cls.is_special,
      reportOptout: true,
      splitIn: row.note,
      prev: "",
      today: "",
      textbook: "",
      makeup: false,
      homeworkToday: "",
    });
  }
  if (splitPlan.outgoing.size > 0) {
    for (const os of byStudent.values()) {
      for (const su of os.subjects) {
        const note = su.classId ? splitPlan.outgoing.get(`${os.id}|${su.classId}`) : undefined;
        if (note) su.splitOut = note;
      }
    }
  }

  // 표시명 유일화 — 화면 state가 (학생, 행 이름)을 키로 쓰므로 같은 이름 두 행은 서로를 덮는다.
  // 원장 선택(2026-07-22): **겹칠 때만** 반 이름을 덧붙인다("수학" → "수학 · 고1 특강"). 평소 화면은 그대로.
  // ⚠️ 반 이름까지 같은 경우(동명 반)엔 그래도 겹치므로 마지막에 순번을 붙여 유일성을 보장한다 —
  //    "보기 좋음"보다 "서로 안 덮음"이 먼저다.
  for (const os of byStudent.values()) {
    const dup = new Map<string, number>();
    for (const su of os.subjects) dup.set(su.name, (dup.get(su.name) ?? 0) + 1);
    for (const su of os.subjects) {
      if ((dup.get(su.name) ?? 0) > 1 && su.className) su.name = `${su.name} · ${su.className}`;
    }
    const used = new Set<string>();
    for (const su of os.subjects) {
      if (!used.has(su.name)) {
        used.add(su.name);
        continue;
      }
      let n = 2;
      while (used.has(`${su.name} (${n})`)) n += 1;
      su.name = `${su.name} (${n})`;
      used.add(su.name);
    }
  }

  // 이전 진도/점수(직전 회차) + 그날 발송 여부 + 그날 출결을 실데이터로 채운다(하드코딩 초기값 대체).
  // 셋 다 studentIds에만 의존하는 독립 조회 → Promise.all 병렬(B4). 전부 fetchInChunks(B2/B3).
  // 앵커 = 대상 날짜(오늘 또는 과거). session_date/report_date/attendance 필터가 모두 이 날짜.
  const todayIso = targetDate;
  // 문항수(/N) 승계 조회 창 — 이보다 오래 안 가르친 학생은 학원 설정값으로 돌아간다(무한 소급 방지).
  const TEST_MAX_LOOKBACK_DAYS = 60;
  const testMaxFrom = addDays(todayIso, -TEST_MAX_LOOKBACK_DAYS);
  const [
    todayReports,
    priorReports,
    attRows,
    sessionRows,
    sheetPlanRows,
    sheetMarkRows,
    textbookRows,
    readStats,
    anomalyEvents,
    priorMaxRows,
  ] = await Promise.all([
    // (a) 당일 행만 — 발송상태·공유링크·초안복원용. eq(report_date)라 학생×과목 소량(절단 불가).
    fetchInChunks<{
      id: string;
      student_id: string;
      subject: string | null;
      class_id: string | null; // 0134a — 행(반) 매칭 키. 이관분·관리자 작성분은 null(과목 폴백).
      makeup: boolean | null; // 보강(수업외) 보고서 — matchReportsToRows가 정규 행에 오배정하지 않게 하는 판별축(2026-07-24).
      share_token: string | null;
      classnote_status: string | null;
      classnote_read_at: string | null; // 학부모 읽음(0122a) — 강사 행 배지용(2026-07-27 원장 지시)
      revoked_at: string | null;
      attachments: { path: string; name: string }[] | null;
      notes: string | null;
      trend_note: string | null;
      // 새로고침 복원용(2026-08-13) — 진도·교재·오늘 과제는 세션에서만 복원됐는데 보강 행은 세션에
      // 저장되지 않아 통째로 사라졌다. 저장된 보고서에서 되채운다(전부 오래된 컬럼 = 스키마 위험 없음).
      progress: string | null;
      textbook: string | null;
      homework_today: string | null;
    }>(
      studentIds,
      (chunk) =>
        supabase
          .from("lesson_reports")
          .select("id, student_id, subject, class_id, makeup, share_token, classnote_status, classnote_read_at, revoked_at, attachments, notes, trend_note, progress, textbook, homework_today, attitude, homework_score, exam_info")
          .eq("report_date", todayIso)
          .in("student_id", chunk)
          // 결정적 매칭 순서 — 같은 (학생,반) 폴백 후보가 여럿일 때 항상 같은 것을 집는다.
          .order("created_at", { ascending: true })
          .order("id", { ascending: true }),
    ),
    // (b) (학생×과목)별 대상 날짜 **직전 최신 1건** — 이전 회차 참고행·prev·prevScore·교재 승계.
    // ⚠️ 옛 코드는 전체 이력을 무페이징 select(B2 위반) → PostgREST 1000행 silent 절단으로 오래된 학생부터 누락.
    // DISTINCT ON RPC(0117a)가 딱 필요한 만큼만 반환(절단 불가). studentIds 배열 파라미터라 청크 불필요(반환행 수백↓).
    supabase.rpc("onescreen_prior_reports", { p_student_ids: studentIds, p_before: todayIso }),
    fetchInChunks<{
      student_id: string;
      class_id: string;
      status: string;
      recorded_at: string;
      // 사유 메모·시수 — 원스크린 출결 pill이 그 자리에서 읽고 고친다(2026-08-05). 출석부와 같은 칸.
      note: string | null;
      session_units: string | number | null;
    }>(
      studentIds,
      (chunk) =>
        supabase
          .from("attendance_records")
          .select("student_id, class_id, status, recorded_at, note, session_units")
          .eq("session_date", todayIso)
          .in("student_id", chunk)
          .order("recorded_at", { ascending: false })
          // id 내림차순 = recorded_at 동률 tie-break(2026-08-17 감사) — 발송 게이트(absence-gate)·
          // effective-records와 같은 규약. 없으면 동시각 중복 행에서 pill과 게이트가 다른 행을 고를 수 있다.
          .order("id", { ascending: false }),
    ),
    // Phase3: 오늘 "작업중" 세션(점수/진도/태도/과제/확정) 복원 — 새로고침에도 유지.
    // ⚠️ 강사축(0118a): 같은 학생을 다른 강사가 가르쳐도 서로 안 덮게 updated_by=본인 세션만 복원.
    fetchInChunks<OnescreenSessionRow>(studentIds, (chunk) =>
      supabase
        .from("onescreen_daily_sessions")
        .select(
          "student_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework, special_note, progress_confirmed, updated_at",
        )
        .eq("session_date", todayIso)
        .eq("updated_by", teacherId)
        .in("student_id", chunk),
    ),
    // (i) **ECS 시트 계획**(2026-08-07) — 그날 그 반에 강사가 이미 적어 둔 교재·진도·과제.
    //     보고서 진도/교재/오늘 과제의 초안이 된다(세션 입력이 있으면 그쪽이 이긴다 — 아래 병합 순서).
    //     🔴 여기서 안 당겨오면 강사가 시트에 쓴 것을 보고서에 **두 번 친다**(실측: 시트가 채워진 257
    //     (반,날짜) 중 보고서가 있는 날 0). 반 id 기준이라 studentIds와 독립 → 같은 Promise.all(B4).
    //     ⚠️ 실패해도 로스터는 떠야 한다(초안 편의 기능이 본 화면을 죽이면 안 됨) — 로그만 남기고 빈 배열.
    fetchAllPagedInChunks<{
      class_id: string;
      slot_start: string;
      line_no: number;
      skill_area: string | null;
      textbook: string | null;
      page_range: string | null;
      progress: string | null;
      homework: string | null;
    }>(activeIds, (chunk, from, to) =>
      // 🔴 **admin 클라이언트로 읽는다** — `class_sheet_*`엔 RLS 정책이 **하나도 없다**(정책 0 = 전부 거부).
      //    사용자 클라이언트로 읽으면 에러 없이 **0행**이 돌아와 초안이 조용히 사라진다(2026-08-07 실측).
      //    ECS 화면(`today.ts`)도 같은 이유로 admin을 쓴다. ⚠️ RLS를 우회하므로 **tenant 필터 필수**
      //    (반 id는 이미 내 담당 반으로 좁혀져 있지만, 격리는 tenant 조건이 진짜 방벽이다).
      admin
        .from("class_sheet_plan_lines")
        .select("class_id, slot_start, line_no, skill_area, textbook, page_range, progress, homework")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("plan_date", todayIso)
        .order("id")
        .range(from, to),
    ).catch((e) => {
      console.error("[roster] ECS 시트 계획 조회 실패 — 보고서 초안 생략:", e instanceof Error ? e.message : e);
      return [] as {
        class_id: string;
        slot_start: string;
        line_no: number;
        skill_area: string | null;
        textbook: string | null;
        page_range: string | null;
        progress: string | null;
        homework: string | null;
      }[];
    }),
    // (j) 시트 **학생별 기록**(`progress_note` = "PL 7, 20개 / PV 4") — 보고서에 자동으로 넣지 않고
    //     화면에 **참고로만** 보여준다(개인 기록은 문맥이 제각각이라 발송물에 자동 삽입하면 위험).
    fetchAllPagedInChunks<{
      class_id: string;
      student_id: string;
      slot_start: string;
      status: string | null;
      progress_note: string | null;
    }>(activeIds, (chunk, from, to) =>
      // 위와 같은 이유로 admin + tenant 필터(정책 0인 표라 사용자 클라이언트는 0행).
      admin
        .from("class_sheet_student_marks")
        .select("class_id, student_id, slot_start, status, progress_note")
        .eq("tenant_id", user.tenantId)
        .in("class_id", chunk)
        .eq("mark_date", todayIso)
        .order("id")
        .range(from, to),
    ).catch((e) => {
      console.error("[roster] ECS 시트 학생 기록 조회 실패 — 참고 표시 생략:", e instanceof Error ? e.message : e);
      return [] as {
        class_id: string;
        student_id: string;
        slot_start: string;
        status: string | null;
        progress_note: string | null;
      }[];
    }),
    // 교재 자동입력 기본값 — 본인 담당 학생의 교재요청서(fetchInChunks, B3). studentIds 독립 → 같은 Promise.all(B4).
    getTextbookOrdersForStudents(studentIds),
    // (f) G3 학부모 읽음 통계 — 학생별 group-by RPC(0124a, 반환 = 학생 수 행이라 절단 불가, B2).
    // 실패해도 로스터는 떠야 하므로 배지만 침묵(fail-soft) — 단 **로그는 남긴다**(적대 리뷰: 무로그 삼킴은
    // 파이프라인 사망을 관측 불가로 만듦. priorReports RPC 실패 로그와 동일 원칙).
    supabase.rpc("onescreen_parent_read_stats", { p_student_ids: studentIds, p_recent: 5 }).then((r) => {
      if (r.error) {
        console.error("[roster] onescreen_parent_read_stats RPC 실패 — 학부모 읽음 배지 생략:", r.error.message);
        return [];
      }
      return r.data ?? [];
    }),
    // (g) G2 진도 이상: 대상 날짜 기준 최근 14일 오류 이벤트(jump/overlap)만. ⚠️ regression 제외 —
    // 실측(07-19) 14일 80건/50명 = 복습 재기록 소음(roster-signals.ts 판정 규칙과 짝). 이벤트 희소(한 자릿수)라 절단 없음.
    // ⚠️ errored 컨테이너 조건은 적대 리뷰로 **제거** — errored는 해제 경로가 없는 종결 기록(묘비)이라
    // 시간 bound 없이 쓰면 배지가 영구 점등(과거 이력 백필 포함 단조 증가 = 신호 붕괴). 모든 jump/overlap이
    // 이벤트를 남기므로 14일 이벤트 창이 같은 신호의 자연 소멸판이다.
    // 컷오프는 Date.now()가 아니라 로스터 대상 날짜(todayIso) 앵커(#11 lint + 과거 날짜 조회 시 그 시점 기준).
    fetchInChunks<{ student_id: string }>(studentIds, (chunk) =>
      supabase
        .from("progress_events")
        .select("student_id")
        .in("event_type", ["jump_error", "overlap_error"])
        // "이상 없음" 확인분 제외(0151a) — 사람이 정상이라 판정한 신호까지 배지가 계속 켜져 있으면
        // 확인 기능이 무의미하다. 진도 탭 이상 카드·알림 감지와 **같은 조건**(#77).
        .is("resolved_at", null)
        .gte("created_at", `${addDays(todayIso, -14)}T00:00:00+09:00`)
        .in("student_id", chunk),
    ).catch((e) => {
      console.error("[roster] progress_events 조회 실패 — 진도 이상 배지 생략:", e instanceof Error ? e.message : e);
      return [] as { student_id: string }[];
    }),
    // (h) 문항수(/N) 승계 — **직전에 이 강사가 이 학생에게 쓴 만점**을 오늘의 기본값으로 이어받는다.
    //     그러지 않으면 매일 학원 설정값(기본 5)으로 되돌아가, 20문항 시험을 보는 반은 날마다 /N을 다시 고쳐야 한다
    //     (실측: 07-21 12·13문항, 07-23 10·100문항이 다음 날 전부 5로 리셋). 원장 지시 2026-07-23.
    //  ⚠️ 강사축(0118a) 유지 — 같은 학생을 다른 강사가 가르쳐도 서로의 문항수를 물려받지 않는다.
    //  ⚠️ 예전엔 표기 모드(0148a)까지 여기서 승계해서 **권한과 무관하게 항상** 돌았다. 모드가 사라진 지금
    //     이 결과는 문항수 시드에만 쓰이므로, 권한이 off면 **아예 조회하지 않는다**(원스크린은 전원이 매일
    //     여는 경로 — 쓰지도 않을 페이지 조회를 남겨 두지 않는다).
    allowTeacherTestMax
      ? fetchAllPagedInChunks<{
          student_id: string;
          session_date: string;
          daily_max: number | null;
          check_max: number | null;
        }>(
          studentIds,
          (chunk, from, to) =>
            supabase
              .from("onescreen_daily_sessions")
              .select("student_id, session_date, daily_max, check_max")
              .eq("updated_by", teacherId)
              .lt("session_date", todayIso)
              .gte("session_date", testMaxFrom)
              .in("student_id", chunk)
              // 최신 우선 + unique tie-break(student_id) — 페이지가 흔들리지 않게(fetchAllPagedInChunks 계약).
              .order("session_date", { ascending: false })
              .order("student_id", { ascending: true })
              .range(from, to),
        ).catch((e) => {
          console.error("[roster] 문항수 승계 조회 실패 — 학원 설정값 사용:", e instanceof Error ? e.message : e);
          return [] as {
            student_id: string;
            session_date: string;
            daily_max: number | null;
            check_max: number | null;
          }[];
        })
      : Promise.resolve(
          [] as {
            student_id: string;
            session_date: string;
            daily_max: number | null;
            check_max: number | null;
          }[],
        ),
  ]);

  // ── ECS 시트 → 보고서 초안(2026-08-07) ────────────────────────────────────────────────────────
  // 접는 규칙은 순수 함수 하나(`buildSheetDraft`, Vitest) — 화면·서버가 같은 문자열을 본다.
  // 영역 라벨은 **학원설정 단일 소스**(운영 enum 하드코딩 금지) — 미등록 키는 라벨 없이 값만 남는다.
  const sheetAreaLabel = new Map(
    resolveSkillAreas(settings.operations.subjects.find((s) => s.key === "english")).map((a) => [
      a.key,
      a.label,
    ]),
  );
  const sheetLinesByClass = new Map<string, SheetPlanLine[]>();
  for (const r of sheetPlanRows) {
    const arr = sheetLinesByClass.get(r.class_id) ?? [];
    arr.push({
      slotStart: r.slot_start,
      lineNo: r.line_no,
      skillArea: r.skill_area,
      textbook: r.textbook,
      pageRange: r.page_range,
      progress: r.progress,
      homework: r.homework,
    });
    sheetLinesByClass.set(r.class_id, arr);
  }
  const sheetDraftByClass = new Map<string, SheetDraft>();
  for (const [classId, lines] of sheetLinesByClass) {
    const draft = buildSheetDraft(lines, (k) => sheetAreaLabel.get(k) ?? null);
    if (hasSheetDraft(draft)) sheetDraftByClass.set(classId, draft);
  }
  // 학생별 기록 — (반|학생)당 교시 순으로 한 줄씩. 표시 전용이라 상태('완'·'결석')는 싣지 않는다
  // (출결은 attendance_records가 진실이고, 시트 상태 라벨을 옆에 두면 두 값이 다툰다).
  const sheetMarkByKey = new Map<string, string>();
  for (const r of [...sheetMarkRows].sort(
    (a, b) => a.slot_start.localeCompare(b.slot_start) || a.student_id.localeCompare(b.student_id),
  )) {
    const note = (r.progress_note ?? "").trim();
    if (!note) continue;
    const key = `${r.class_id}|${r.student_id}`;
    const prev = sheetMarkByKey.get(key);
    sheetMarkByKey.set(key, prev ? `${prev}\n${note}` : note);
  }

  const seededDailyMax = new Set<string>();
  const seededCheckMax = new Set<string>();
  // 학생별 **가장 최근** 값(정렬 최신순 → 처음 만난 값이 직전 값) → 오늘의 기본값으로 승계.
  // 오늘 세션이 있으면 아래 Phase3 복원이 다시 덮으므로, 여기서 넣는 건 "오늘 아직 안 건드린 행"의 출발값이다.
  for (const r of priorMaxRows) {
    const os = byStudent.get(r.student_id);
    if (!os) continue;
    // 문항수 승계 — allowTeacherTestMax on일 때만(off=과목 설정값 고정).
    if (allowTeacherTestMax && r.daily_max != null && !seededDailyMax.has(r.student_id)) {
      os.tests.daily.max = r.daily_max;
      seededDailyMax.add(r.student_id);
    }
    if (allowTeacherTestMax && r.check_max != null && !seededCheckMax.has(r.student_id)) {
      os.tests.check.max = r.check_max;
      seededCheckMax.add(r.student_id);
    }
  }
  type PriorRow = {
    student_id: string;
    subject: string | null;
    class_id: string | null; // 0135a — 반 단위 직전 회차. 이관분은 null(과목 폴백).
    report_date: string;
    progress: string | null;
    exam_info: string | null;
    textbook: string | null;
    homework_today: string | null;
    homework_score: string | null;
    attitude: string | null;
    notes: string | null;
    /**
     * 같은 단위(반|과목)의 **최근 진도 5건, 최신순**(0152a). '이전 진도'가 시험 회차("월말평가" 등)로
     * 덮이지 않게 앱이 여기서 **시험이 아닌 첫 값**을 고른다 — 판정을 앱에 두는 이유는 상태 라벨 목록을
     * SQL에 복제하지 않기 위해서다(progress-status.ts 단일 소스). RPC 미배포 시 undefined → 기존 동작.
     */
    recent_progress: string[] | null;
  };
  // RPC 에러는 무신호 삼킴 금지(B2/B3) — 다만 이전회차는 '보강' 데이터라 throw로 화면 전체를 죽이지 않고 로그+graceful.
  // (0117a 미배포·일시장애 시 이전회차/prevScore/교재승계만 빠지고 당일 데이터·세션은 정상 렌더 → 진단 가능하게 로그.)
  if (priorReports.error)
    console.error("[roster] onescreen_prior_reports RPC 실패 — 이전 회차 데이터 생략:", priorReports.error.message);
  const priorRows = (priorReports.data ?? []) as PriorRow[];
  const sessionById = new Map(sessionRows.map((r) => [r.student_id, r]));

  // 학생별 대표 교재 — 강사 본인 주문 우선, (requestDate ?? createdAt) 최신, book_name 공란 제외.
  // ⚠️ `textbook_orders`엔 **과목 컬럼이 없다** → 학생 단위 대표 1건뿐이라 어느 과목 교재인지 모른다.
  //    그래서 아래 적용은 **math 행에만** 한다(LEGACY_REPORT_SUBJECT와 같은 근거 — 실측 2026-07-29
  //    전체 442건이 전부 수학 교재 '가우스/초N-M 발전/내신대비 중N-M'이고 영어 교재는 0건).
  //    📌 영어 교재요청이 실제로 생기면 이 폴백으론 못 가르므로 `textbook_orders.subject` 컬럼이 정답이다.
  const bookByStudent = new Map<string, string>();
  {
    const byStudent = new Map<string, typeof textbookRows>();
    for (const t of textbookRows) {
      if (!t.studentId || !t.bookName?.trim()) continue;
      const arr = byStudent.get(t.studentId) ?? [];
      arr.push(t);
      byStudent.set(t.studentId, arr);
    }
    for (const [sid, arr] of byStudent) {
      const pick = [...arr].sort((a, b) => {
        const at = a.teacherName === teacherName ? 0 : 1;
        const bt = b.teacherName === teacherName ? 0 : 1;
        if (at !== bt) return at - bt; // 강사 본인 주문 먼저
        return (b.requestDate ?? b.createdAt ?? "").localeCompare(a.requestDate ?? a.createdAt ?? ""); // 최신
      })[0];
      if (pick?.bookName?.trim()) bookByStudent.set(sid, pick.bookName.trim());
    }
  }

  // student별: 오늘 저장된 보고서 존재(reportSent) + 오늘 이전 최신 보고서(prev 진도/prevScore).
  // 🔴 매칭 단위 = **반**(0134a). 예전엔 (학생, 과목) 한 키였는데, 같은 과목 두 반(정규+특강)이 생기면서
  //    한 보고서가 두 행에 붙거나 엉뚱한 반의 진도가 뜬다 → 반 우선 1:1 매칭(matchReportsToRows, Vitest).
  //    반이 없는 보고서(이관분·관리자 작성·0134a 이전 저장분)는 과목으로 폴백하되 **한 행만** 가져간다.
  const sentToday = new Set<string>();
  const todayByStudent = new Map<string, typeof todayReports>();
  for (const r of todayReports) {
    sentToday.add(r.student_id);
    const arr = todayByStudent.get(r.student_id);
    if (arr) arr.push(r);
    else todayByStudent.set(r.student_id, [r]);
  }
  const todayReportIds = todayReports.map((r) => r.id);
  /**
   * '이전 진도' = **진도가 중단된 날(시험)을 건너뛴** 직전 실제 진도(0152a + progress-status.ts).
   * 원장 2026-07-28: *"그 날은 시험을 치기 때문에 진도가 '중단'되는 날"* — 다음 회차의 기준점은
   * 그 전 차시여야 한다. 최근 5건이 전부 시험이면 null → 호출부가 기존 동작(직전 회차 그대로)로 폴백.
   * ⚠️ 직전 회차 자체(prevReport·교재 승계·prevScore)는 건드리지 않는다 — 그건 실제 회차가 사실이다.
   */
  const carryProgressOf = (r: PriorRow): string | null => carryProgress(r.recent_progress);
  // 이 강사 화면에 실제로 있는 행들의 과목(학생별) — 아래 학생단위 폴백의 과목 게이트.
  // 행 과목 미지정은 math 간주(report-unit 3차·G2 배지와 같은 규약).
  const rowSubjectsByStudent = new Map<string, Set<string>>();
  for (const os of byStudent.values())
    rowSubjectsByStudent.set(
      os.id,
      new Set(os.subjects.map((su) => su.subjectKey?.trim() || LEGACY_REPORT_SUBJECT)),
    );
  /** 직전 회차 1건의 과목 — 보고서 subject → 반의 과목 → 레거시(math). 시간표 hover와 **같은 단일 소스**. */
  const subjectOfPrior = (r: PriorRow): string =>
    reportSubject({ subject: r.subject, classSubject: r.class_id ? classById.get(r.class_id)?.subject : null });
  // 학생단위 직전(prev 진도·prevScore 폴백) = 그 학생 과목행들 중 최신 회차.
  const priorReport = new Map<string, { progress: string | null; examInfo: string | null; date: string }>();
  // 학생별 직전 회차 후보 — RPC(0135a)가 이미 (학생, 반|과목) 최신 1건씩 반환. 행 매칭은 아래에서.
  const priorByStudent = new Map<string, PriorRow[]>();
  for (const r of priorRows) {
    const arr = priorByStudent.get(r.student_id);
    if (arr) arr.push(r);
    else priorByStudent.set(r.student_id, [r]);
    // 🔴 **과목 게이트**(원장 제보 2026-07-29) — 이 폴백은 반을 안 보므로 과목마저 안 보면 학생의
    //    **아무 과목** 최신 회차가 들어온다. 영어 강사 화면에서 그건 100% 수학이었다(subject='english'
    //    보고서 실측 0건) → 영어 행의 '이전 진도'와 점수 증감(▲▼)이 수학 회차 기준으로 표시됐다.
    //    화면에 그 과목 행이 있는 보고서만 후보로 삼는다(행 매칭은 아래 matchReportsToRows가 더 정확히 한다).
    if (!rowSubjectsByStudent.get(r.student_id)?.has(subjectOfPrior(r))) continue;
    const cur = priorReport.get(r.student_id);
    if (!cur || r.report_date > cur.date)
      // progress만 carry(시험 회차 건너뜀) — examInfo는 **실제 직전 회차** 것이어야 한다(그날 본 시험 점수가
      // prevScore의 진짜 직전 값이다. 여기까지 소급하면 증감이 엉뚱한 회차와 비교된다).
      priorReport.set(r.student_id, {
        progress: carryProgressOf(r) ?? r.progress,
        examInfo: r.exam_info,
        date: r.report_date,
      });
  }

  // 오늘 보고서들의 학부모 열람 수(share_link_views) — PostgREST group-by 대신 행을 청크로 가져와 JS 집계(fetchInChunks).
  const viewCountByReport = new Map<string, number>();
  const viewRows = await fetchInChunks<{ lesson_report_id: string }>(todayReportIds, (chunk) =>
    supabase.from("share_link_views").select("lesson_report_id").in("lesson_report_id", chunk),
  );
  for (const v of viewRows)
    viewCountByReport.set(v.lesson_report_id, (viewCountByReport.get(v.lesson_report_id) ?? 0) + 1);
  // student별 오늘 출결이 있는 **내 반** — 행에 못 붙은 칸(반 모호 행 등)을 배지 재료로 넘기기 위해(아래 attendanceOffRow).
  // ⚠️ 강사 담당 반 기록만(myClassIdSet) — 타 강사·타 반의 그날 기록을 집으면 이 화면 배지가 행 pill과 모순된다.
  const myClassIdSet = new Set(allIds); // 강사 담당 전 반
  const myAttClassesByStudent = new Map<string, Set<string>>();
  for (const a of attRows) {
    if (!myClassIdSet.has(a.class_id)) continue;
    const set = myAttClassesByStudent.get(a.student_id);
    if (set) set.add(a.class_id);
    else myAttClassesByStudent.set(a.student_id, new Set([a.class_id]));
  }
  // (학생×반) 최신 raw — 출결 pill(2단계)의 행 단위 값. 축약(toMark)과 별개로 raw 보존(조퇴·보강 되쓰기 방지).
  // 메모·시수도 **같은 최신 행에서** 함께 집는다(2026-08-05) — 상태만 최신 행에서, 메모는 다른 행에서
  // 집으면 화면이 존재하지 않는 조합을 보여주고, 그걸 저장하면 실제 기록이 뒤섞인다.
  const attByRow = new Map<string, { status: string; note: string | null; units: number | null }>();
  for (const a of attRows) {
    const k = `${a.student_id}::${a.class_id}`;
    if (attByRow.has(k)) continue;
    // numeric은 postgres-js/PostgREST에서 문자열로 올 수 있다 — 숫자로 정규화(NaN은 기본값 취급).
    const u = a.session_units == null ? null : Number(a.session_units);
    attByRow.set(k, { status: a.status, note: a.note ?? null, units: Number.isFinite(u) ? u : null });
  }

  // 오늘 수학 채점 결과(개발 중 — 학원 설정 → 연동 → 오늘 수학 토글 ∧ 지점 라이선스). 토글이 꺼진 학원은 조회 자체가 없다.
  // 아래 루프의 덮어쓰기(보고서 · 시트 · 세션)가 다 끝난 뒤 빈 칸만 채운다(todays-math-fill-rules.ts).
  const todaysMathRows =
    settings.report.todaysMathTestFill && (await isFeatureOptedIn(user.tenantId, "todays_math"))
      ? await loadTodaysMathFill(admin, user.tenantId, targetDate, [...byStudent.keys()])
      : [];

  for (const os of byStudent.values()) {
    os.reportSent = sentToday.has(os.id);
    // 행(반)별 오늘 보고서 — 반 정확매칭 우선, 반 없는 행은 과목으로 **1:1** 폴백(matchReportsToRows).
    // ⚠️ 한 보고서를 두 행에 붙이면 두 행의 저장이 서로를 덮는다 → 소비형 매칭이 불변식이다.
    const todayMatched = matchReportsToRows(
      os.subjects.map((su) => ({
        classId: su.classId ?? null,
        subjectKey: su.subjectKey ?? null,
        isSpecial: su.isSpecial,
        // 보강 행은 전용 단계로만 매칭된다(반 없음 + 정규 보고서 오배정 금지) — report-unit.ts 1.5차.
        isMakeup: !!su.makeup && !su.classId,
      })),
      (todayByStudent.get(os.id) ?? []).map((r) => ({ ...r, classId: r.class_id })),
    );
    // 오늘 저장된 보고서를 행 이름으로 보관 — 아래 ⑤에서 진도·교재·오늘 과제를 되채운다.
    // 🔴 왜 필요한가(원장 제보 2026-08-13 "입력해놓은 내용이 일부 새로고침시에 삭제"): 이 값들은
    //    **세션에서만** 복원됐는데 보강 행은 세션에 저장되지 않았다 → 발송까지 끝낸 보강 보고서도
    //    새로고침하면 진도·교재·오늘 과제가 빈칸으로 돌아왔다(DB엔 멀쩡히 있는데도).
    const savedToday = new Map<
      string,
      {
        progress: string | null;
        textbook: string | null;
        homework_today: string | null;
        // 🔴 태도·과제 수행률·테스트도 함께 실는다 — **보강 전용 카드는 세션에 저장되지 않아**
        //    이 경로가 유일한 복원처다. 안 실으면 화면이 빈칸으로 뜨고, 그 상태로 다시 저장하면
        //    DB에 멀쩡히 있던 값이 null로 덮인다(실측 보강 전용 245행 중 과제 211·태도 96·테스트 45).
        attitude: string | null;
        homework_score: string | null;
        exam_info: string | null;
      }
    >();
    os.subjects.forEach((su, i) => {
      const t = todayMatched[i];
      if (!t) return;
      savedToday.set(su.name, {
        progress: t.progress,
        textbook: t.textbook,
        homework_today: t.homework_today,
        attitude: (t as { attitude?: string | null }).attitude ?? null,
        homework_score: (t as { homework_score?: string | null }).homework_score ?? null,
        exam_info: (t as { exam_info?: string | null }).exam_info ?? null,
      });
      su.reportSent = true;
      su.shareToken = t.share_token ?? undefined;
      su.classnoteStatus = t.classnote_status ?? undefined;
      su.classnoteReadAt = t.classnote_read_at ?? undefined;
      su.revokedAt = t.revoked_at ?? undefined;
      su.viewCount = viewCountByReport.get(t.id) ?? 0;
      su.attachments = t.attachments ?? [];
      // 발송본 멘트/추세 = 초안 복원 폴백 — 아래 세션 블록이 비어있지 않은 세션 초안으로 덮음(작업중 편집 우선).
      if (t.notes) su.draft = t.notes;
      if (t.trend_note) su.trendDraft = t.trend_note;
    });
    // 행(반) 단위 raw 출결 — 출결 pill(2단계). classId 모호(null)면 미채움=pill 숨김.
    for (const su of os.subjects) {
      if (!su.classId) continue;
      const rec = attByRow.get(`${os.id}::${su.classId}`);
      su.attendanceRaw = rec?.status ?? null;
      su.attendanceNote = rec?.note ?? null;
      su.attendanceUnits = rec?.units ?? null;
      // 수학 자동 시수 — 값이 있을 때만 싣는다(hot path라 모든 행에 null을 얹지 않는다). 기록이 생긴 뒤엔
      // 화면이 저장값(attendanceUnits)을 쓰므로 여기 남아 있어도 표시에 끼지 않는다(SessionUnitsField).
      const autoUnits = autoUnitsByClass.get(su.classId);
      if (autoUnits !== undefined) su.attendanceAutoUnits = autoUnits;
    }
    // 학생 배지 — 행 raw + 행에 못 붙은 내 반 칸을 **우선순위로** 모은다(결석 > 조퇴 > 지각 > 출석).
    // 표는 [attendance-mark.ts](../attendance-mark.ts) `studentMarkFromRows` 단일 소스 — 클라(낙관 반영·스트립 반영)가
    // 같은 함수로 다시 계산하므로 새로고침 전후 배지가 같다.
    const rowClassIds = new Set(os.subjects.map((su) => su.classId).filter(Boolean));
    const offRow: Record<string, string> = {};
    let offRowCount = 0;
    for (const cid of myAttClassesByStudent.get(os.id) ?? []) {
      if (rowClassIds.has(cid)) continue;
      const rec = attByRow.get(`${os.id}::${cid}`);
      if (rec) {
        offRow[cid] = rec.status;
        offRowCount += 1;
      }
    }
    if (offRowCount) os.attendanceOffRow = offRow;
    os.attendance = studentMarkFromRows(os);
    const pr = priorReport.get(os.id);
    // 🔴 이 폴백은 **학생 단위**(반 무관) 직전 회차다 — 정규/특강을 구분하지 못한다(원장 2026-07-23).
    //    특강 행만 있는 학생은 없으므로(특강은 정규와 함께 듣는다) 특강 행에 이 값이 들어가면
    //    "이전 진도"·"지난 회차 대비 ▲2"가 **정규 수업 기준**으로 표시된다. 행별 매칭(priorMatched)이
    //    성공하면 아래에서 덮이지만, 특강 첫 수업이면 덮을 게 없어 정규 값이 그대로 남는다.
    //    → 특강 행이 하나라도 있으면 이 학생단위 폴백을 통째로 끄고, 행별 매칭에만 맡긴다.
    const hasSpecialRow = os.subjects.some((su) => su.isSpecial);
    if (pr && !hasSpecialRow) {
      const { daily, check } = parseExamScores(pr.examInfo);
      os.tests.daily.prevScore = daily;
      os.tests.check.prevScore = check;
      if (pr.progress) {
        // 이전 진도 텍스트("수학 1-1-2 …")를 과목명 접두로 매칭 → 그 과목 prev. 폴백=첫 과목.
        // ⚠️ 접두는 **순수 과목 라벨**(subjectLabel)로 본다 — 행 이름(name)엔 반 이름이 붙을 수 있어
        //    "수학 · 고1 특강"으로는 저장된 진도("수학 …")와 절대 안 맞는다.
        let matched = false;
        for (const su of os.subjects) {
          const label = su.subjectLabel || su.name;
          if (label && pr.progress.startsWith(label)) {
            su.prev = pr.progress.slice(label.length).trim() || pr.progress;
            matched = true;
          }
        }
        if (!matched && os.subjects[0]) os.subjects[0].prev = pr.progress;
      }
    }
    // (학생×과목) 직전 회차 → 참고행(prevReport) + 과목 정확매칭 prev + 교재 자동입력 기본값(②교재요청서 > ③직전교재).
    // ①오늘 입력값(세션)은 아래 sess 블록이 최종으로 덮으므로 항상 우선. su.textbook 초기값은 ""(과목 push).
    const reqBook = bookByStudent.get(os.id);
    // 행(반)별 직전 회차 — 오늘 행과 같은 매칭 규약(반 → 과목 → 이관분(단일과목만)). 소비형이라 두 행이
    // 같은 직전 회차를 나눠 갖지 않는다(특강 행에 정규 진도가 뜨던 문제).
    // ⚠️ 이관분 폴백(과목·반 둘 다 없는 행)은 단일 과목 학생만 — matchReportsToRows 3차 규칙과 동일.
    //    ijw 이식분은 대부분 subject가 비어 있어(실측 17,337/17,345 NULL) 이 폴백이 없으면 참고행·교재 승계가 0건이 된다.
    const priorMatched = matchReportsToRows(
      os.subjects.map((su) => ({
        classId: su.classId ?? null,
        subjectKey: su.subjectKey ?? null,
        isSpecial: su.isSpecial,
        // 보강 행은 전용 단계로만 매칭된다(반 없음 + 정규 보고서 오배정 금지) — report-unit.ts 1.5차.
        isMakeup: !!su.makeup && !su.classId,
      })),
      (priorByStudent.get(os.id) ?? []).map((r) => ({ ...r, classId: r.class_id })),
      // 이관분(반·과목 둘 다 없음) 폴백은 **직전 회차에서만** — 당일 행에 켜면 edutrix가 오늘 넣은
      // 남의 보고서가 "이미 저장됨"으로 붙는다(report-unit.ts 🔴 참조).
      { legacyFallback: true },
    );
    os.subjects.forEach((su, i) => {
      const pbs = priorMatched[i];
      const label = su.subjectLabel || su.name;
      if (pbs) {
        const prog =
          pbs.progress && label && pbs.progress.startsWith(label)
            ? pbs.progress.slice(label.length).trim() || pbs.progress
            : pbs.progress;
        su.prevReport = {
          date: pbs.report_date,
          progress: prog ?? null,
          textbook: pbs.textbook ?? null,
          homeworkToday: pbs.homework_today ?? null,
          homeworkScore: pbs.homework_score ?? null,
          attitude: pbs.attitude ?? null,
          examInfo: pbs.exam_info ?? null,
          note: pbs.notes ?? null,
        };
        if (prog) su.prev = prog; // 과목 정확매칭 prev 우선(위 startsWith 학생단위 폴백보다 정확)
        // '이전 진도'만 시험 회차를 건너뛴 값으로 덮는다(0152a). prevReport(참고행)·교재 승계는 위에서
        // 실제 직전 회차로 이미 채워졌고 그대로 둔다 — 그날이 월말평가면 참고행엔 월말평가가 떠야 맞다.
        const carry = carryProgressOf(pbs);
        if (carry) su.prev = label && carry.startsWith(label) ? carry.slice(label.length).trim() || carry : carry;
      }
      // ③ 직전 교재(과목 매칭된 prevReport라 이미 그 과목 것) — 끝의 쪽수는 떼고 가져온다(원장 2026-10-23, textbook-carry.ts:
      //    지난 쪽수가 매 보고서에 따라와 학부모에게 오늘 쪽수로 보였다). 참고행(prevReport)은 원문 그대로 둔다.
      const prevBook = stripTextbookPages(su.prevReport?.textbook ?? "");
      if (prevBook) su.textbook = prevBook;
      // ② 교재요청서(덮음) — **math 행에만**. 과목 컬럼이 없어 영어 행에 주면 수학 교재가 영어 보고서
      //    교재명 칸에 **미리 채워진 채** 저장·발송된다(실측: 영어 행에 '초5-2 발전 1권'·'가우스 중1-1 2권').
      if (reqBook && (su.subjectKey?.trim() || LEGACY_REPORT_SUBJECT) === LEGACY_REPORT_SUBJECT)
        su.textbook = reqBook;
      // ④ **ECS 시트**(2026-08-07) — 그날 그 반 계획이 있으면 진도·과제·교재의 초안이 된다.
      //    · 진도·오늘 과제는 보고서에 **원래 값이 없다**(직전 회차는 prev로만 들어간다) → 시트가 채운다.
      //    · 교재는 직전 교재(③)를 덮는다 — 그날 실제로 편 책이 어제 것보다 정확하다. 단 math 행에서
      //      교재요청서(②)가 이미 채웠으면 그건 **학생별** 맞춤이라 건드리지 않는다.
      //    ⚠️ 세션(오늘 작업중 입력)은 아래 sess 블록이 최종으로 덮는다 — 강사가 고친 값이 항상 이긴다.
      const sheet = su.classId ? sheetDraftByClass.get(su.classId) : undefined;
      if (sheet) {
        su.sheetDraft = sheet;
        // 🔴 **이미 저장된 오늘 보고서 행에는 채우지 않는다**(적대적 리뷰 2026-08-07). 그 행은 편집이
        //    잠겨 있고(fieldset disabled) 값도 발송본에서 복원되지 않는데, 거기에 시트 값을 넣으면
        //    **발송한 내용과 다른 글이 잠긴 칸에 떠서** 강사가 그걸 보낸 줄 안다. 참고 패널(sheetDraft)만 남긴다.
        if (!su.reportSent) {
          if (sheet.progress && !su.today) su.today = sheet.progress;
          if (sheet.homework && !su.homeworkToday) su.homeworkToday = sheet.homework;
          const isMathRow = (su.subjectKey?.trim() || LEGACY_REPORT_SUBJECT) === LEGACY_REPORT_SUBJECT;
          if (sheet.textbook && !(isMathRow && reqBook)) su.textbook = sheet.textbook;
        }
      }
      // ⑤ **오늘 이미 저장된 보고서**가 있으면 그 값으로 되채운다 — 시트 계획(④)·직전 교재(③)보다 세고,
      //    아래 세션(작업중 편집)보다는 약하다. 진도 접두("수학 …")는 저장 시 붙인 것이라 떼고 넣는다.
      //    ⚠️ **빈 칸만** 채운다 — 위에서 이미 채워진 값을 덮지 않는다.
      const saved = savedToday.get(su.name);
      if (saved) {
        const label = su.subjectLabel || su.name;
        const prog = (saved.progress ?? "").trim();
        if (prog && !su.today) su.today = label && prog.startsWith(label) ? prog.slice(label.length).trim() || prog : prog;
        if (saved.textbook && !su.textbook) su.textbook = saved.textbook;
        if (saved.homework_today && !su.homeworkToday) su.homeworkToday = saved.homework_today;
        // 🔴 아래 셋은 **행 단위 값**이라 세션이 없으면 되살릴 곳이 여기뿐이다(보강 전용 카드).
        //    ⑤의 규약대로 **빈 칸만** 채운다 — 아래 세션 블록(작업중 편집)이 여전히 최종으로 이긴다.
        if (saved.attitude && su.attitude == null) su.attitude = saved.attitude;
        if (saved.homework_score && !su.homework) su.homework = saved.homework_score;
        // 점수는 분자·분모를 **기존 두 헬퍼**로 읽는다(새 파서를 만들지 않는다 — 같은 판정 두 벌 금지).
        const savedScore = parseExamScores(saved.exam_info);
        const savedMax = parseExamMaxes(saved.exam_info);
        if (savedScore.daily != null && su.dailyScore == null) {
          su.dailyScore = savedScore.daily;
          if (savedMax.daily != null) su.dailyMax = savedMax.daily;
        }
        if (savedScore.check != null && su.checkScore == null) {
          su.checkScore = savedScore.check;
          if (savedMax.check != null) su.checkMax = savedMax.check;
        }
      }
      // 학생별 시트 기록은 **참고 표시 전용**(자동 삽입 금지 — 개인 기록은 문맥이 제각각이다).
      const mark = su.classId ? sheetMarkByKey.get(`${su.classId}|${os.id}`) : undefined;
      if (mark) su.sheetStudentNote = mark;
    });
    // Phase3: 오늘 세션(작업중) 복원 — 점수/진도/태도/과제/확정을 하드코딩 기본값 위에 덮어씀.
    const sess = sessionById.get(os.id);
    if (sess) {
      if (sess.updated_at) os.sessionUpdatedAt = sess.updated_at;
      if (sess.study_grade) os.studyGrade = sess.study_grade;
      if (sess.daily_score != null) os.tests.daily.score = sess.daily_score;
      if (sess.daily_max != null) os.tests.daily.max = sess.daily_max;
      if (sess.check_score != null) os.tests.check.score = sess.check_score;
      if (sess.check_max != null) os.tests.check.max = sess.check_max;
      if (sess.attitude != null) os.attitude = sess.attitude;
      if (sess.homework != null) os.homework = sess.homework;
      if (sess.special_note != null) os.note = sess.special_note;
      if (sess.progress_confirmed != null) os.progressConfirmed = sess.progress_confirmed;
      const sp = sess.subject_progress ?? {};
      // 구버전(과목키) 세션 항목은 **한 행만** 가져간다 — 배포 당일 작업중이던 입력을 살리되,
      // 같은 과목 두 행이 같은 항목을 나눠 갖고 같은 진도를 보여주는 것을 막는다(적대 검수 확정).
      const legacyTaken = new Set<string>();
      for (const su of os.subjects) {
        // 세션 키 = **반**(0134a) — 과목키로 두면 같은 과목 두 행(정규+특강)이 한 항목을 공유해
        // 한쪽에 입력한 진도가 다른 쪽에도 뜬다(그리고 저장할 때 서로를 덮는다).
        // 보강 행(반 없음)은 **전용 키**를 쓴다(2026-08-13) — 맨 과목키로 저장하면 아래 legacyKey 폴백이
        // 그 항목을 집어 **보강 진도가 정규 행에 새어들었다**(그래서 예전엔 보강을 아예 저장하지 않았고,
        // 그 대가로 보강 입력이 새로고침에 사라졌다). 키를 분리하면 둘 다 해결된다.
        const makeupKey = su.makeup && !su.classId ? `makeup::${su.subjectKey || su.name}` : null;
        const byClass = makeupKey ? sp[makeupKey] : su.classId ? sp[su.classId] : undefined;
        const legacyKey = su.subjectKey || su.name;
        let entry = byClass;
        // ⚠️ 보강 행은 legacyKey 폴백을 **타지 않는다** — 그 폴백이 바로 교차오염의 통로였다.
        // 나눔 행(0351a)도 타지 않는다 — 옛 과목키 항목은 원래 반 행의 것이다(나눔 행은 보고서가 잠겨 있다).
        if (!entry && !makeupKey && !su.splitIn && !legacyTaken.has(legacyKey)) {
          entry = sp[legacyKey];
          if (entry) legacyTaken.add(legacyKey);
        }
        if (entry?.today) su.today = entry.today;
        // 오늘 수업 성격(복습·문제풀이) — 진도와 함께 세션에 실린다(progress-mode.ts, 마이그 0).
        // ⚠️ `!= null`이라 빈 문자열(해제)도 복원한다 — 켰다가 끈 상태가 새로고침에 되살아나면 안 된다.
        if (entry?.mode != null) su.progressMode = entry.mode || null;
        if (entry?.textbook != null) su.textbook = entry.textbook;
        // 🔴 반 없는 보강 줄은 늘 보강이다 — '보강 빼기' 표시({makeup:false})가 남은 날 예약·출석부 칸이 같은 줄을 다시 세우면
        //    그 표시가 줄을 '보강 아님'으로 덮어 반도 보강도 없는 줄이 됐다(적대 리뷰 2026-10-27). 정규 줄의 '정규+보강' 토글만 세션을 따른다.
        if (entry?.makeup != null && !makeupKey) su.makeup = entry.makeup;
        if (entry?.homeworkToday != null) su.homeworkToday = entry.homeworkToday;
        if (typeof entry?.videoHomework === "boolean") su.videoHomework = entry.videoHomework;
        if (typeof entry?.videoSubmitLink === "boolean") su.videoSubmitLink = entry.videoSubmitLink;
        if (entry?.videoHomeworkDue === "week" || entry?.videoHomeworkDue === "next") su.videoHomeworkDue = entry.videoHomeworkDue;
        // 미발송 멘트/추세 초안 복원 — 세션에 실제 텍스트가 있을 때만 발송본 폴백 위에 덮는다.
        // (lesson_reports엔 updated_at이 없어 신구 비교 불가 → 빈 세션 초안은 발송본 복원을 지우지 않음.)
        if (entry?.draft?.trim()) su.draft = entry.draft;
        if (entry?.trendDraft?.trim()) su.trendDraft = entry.trendDraft;
        // 자동작성 스냅샷(0214a) — 초안과 같은 규약으로 복원. 없으면 미복원(발송본 notes 복원 행은 스냅샷을
        // 모른다 — 그 경우 저장 시 서버 sticky(resolveMentSource)가 기존 라벨로 보수 판정한다.
        if (entry?.autoDraft?.trim()) su.autoDraft = entry.autoDraft;
        if (entry?.trendAutoDraft?.trim()) su.trendAutoDraft = entry.trendAutoDraft;
        if (entry?.autoDraftTemplate === true) su.autoDraftTemplate = true;
        // 영어 템플릿 모드(2026-09-10) — 영어 행만 실려 있다(수학 세션엔 키 자체가 없어 아래는 전부 건너뛴다).
        if (entry?.templateId) su.templateId = entry.templateId;
        if (entry?.nextTest != null) su.nextTest = entry.nextTest;
        // EiE 일일 보고서(2026-11-06) — 단어 테스트 피드백 · 재시험. 모양을 믿지 않는다(jsonb 검증 없음).
        if (typeof entry?.wordFeedback === "string") su.wordFeedback = entry.wordFeedback.slice(0, 1000);
        if (entry?.wordRetest === true) su.wordRetest = true;
        if (entry?.aiIntro != null) su.aiIntro = entry.aiIntro;
        if (entry?.aiComment != null) su.aiComment = entry.aiComment;
        if (entry?.templateHash) su.templateHash = entry.templateHash;
        if (entry?.aiFactsHash) su.aiFactsHash = entry.aiFactsHash;
        if (entry?.composedFactsHash) su.composedFactsHash = entry.composedFactsHash;
        // 행 단위 평가값(2026-08-13) — 지정된 행만 실려 있다. 없으면 su.*를 undefined로 두어
        // resolveRowFields가 학생 값(아래 sess 컬럼)으로 폴백한다 = 옛 세션 하위호환.
        if (entry?.attitude !== undefined) su.attitude = entry.attitude;
        if (entry?.homework !== undefined) su.homework = entry.homework;
        if (entry?.note !== undefined) su.note = entry.note;
        if (entry?.dailyScore !== undefined) su.dailyScore = entry.dailyScore;
        if (entry?.dailyMax !== undefined) su.dailyMax = entry.dailyMax;
        if (entry?.checkScore !== undefined) su.checkScore = entry.checkScore;
        if (entry?.checkMax !== undefined) su.checkMax = entry.checkMax;
        // 소단원별 이해도(수학 보고서 시범, math-report-pilot.ts) — 시범 행만 실려 있다.
        if (entry?.understanding !== undefined) su.understanding = readUnderstanding(entry.understanding);
        if (entry?.dailyTestSkip !== undefined) su.dailyTestSkip = readTestSkip(entry.dailyTestSkip);
        if (entry?.homeworkMissReason !== undefined) su.homeworkMissReason = readHomeworkMissReason(entry.homeworkMissReason);
        if (entry?.attitudeNote !== undefined) su.attitudeNote = readAttitudeNote(entry.attitudeNote);
        if (entry?.lessonMemo !== undefined) su.lessonMemo = readLessonMemo(entry.lessonMemo);
        if (entry?.makeupReason !== undefined) su.makeupReason = readMakeupReason(entry.makeupReason);
      }
    }
    // 보강 예약 표식 + 합침('정규+보강') — 🔴 세션 복원 **뒤**(세션은 줄마다 makeup:false를 늘 저장해 앞서 켠 값을 덮는다).
    applyReservedMakeup(os, reservedPlan);
    // ⚠️ 척도 경계에서 prevScore 폐기: 직전 회차의 문항수(exam_info 분모)가 오늘의 문항수와 다르면
    //    (5문항 ↔ 20문항) prevScore를 그대로 빼면 "▲15" 같은 허위 증감이 학부모에게 나간다.
    //    같을 때만 유지(같은 문항수의 직전 회차가 쌓이면 다음 회차부터 정상 복원).
    const prMax = parseExamMaxes(pr?.examInfo);
    if (prMax.daily != null && prMax.daily !== os.tests.daily.max) os.tests.daily.prevScore = null;
    if (prMax.check != null && prMax.check !== os.tests.check.max) os.tests.check.prevScore = null;
    if (todaysMathRows.length) {
      applyTodaysMathFill(os, todaysMathRows, {
        daily: showDailyTest,
        check: showCheckTest,
        isMathRow: (su) => (su.subjectKey?.trim() || LEGACY_REPORT_SUBJECT) === LEGACY_REPORT_SUBJECT,
      });
      // 위 척도 경계 규칙을 채운 칸에도 — 오늘 수학 시험은 문항 수가 평소(과목 설정 5문항 등)와 달라, 직전 회차 점수와
      // 그대로 빼면 허위 증감("▲15")이 학부모 글에 나간다. 직전 회차 문항 수와 다르면 그 시험의 직전 점수를 버린다.
      for (const su of os.subjects) {
        if (su.todaysMath?.daily && prMax.daily != null && prMax.daily !== su.todaysMath.daily.max) os.tests.daily.prevScore = null;
        if (su.todaysMath?.check && prMax.check != null && prMax.check !== su.todaysMath.check.max) os.tests.check.prevScore = null;
      }
    }
    // 이 학생이 수강 중인 담당 반 전체(tags) — enrollments 기준(모호 과목 포함, 위 F4 후속 회귀 주석 참조). 비면 대표 tag 폴백.
    const classNames = [...(classNamesByStudent.get(os.id) ?? [])];
    os.tags = classNames.length ? classNames : os.tag ? [os.tag] : [];
  }

  const gradeRank = (g: string) => {
    const i = gradeOrder.indexOf(g);
    return i === -1 ? 999 : i;
  };
  // 오늘 수업(반) 위젯 + 반별 필터/그룹 — 반별 학생수 + 시작시각, 시각순.
  const countByClass = new Map<string, number>();
  for (const e of enrollments) countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  const todayClasses: TodayClass[] = activeClasses
    .map((c) => ({
      id: c.id,
      name: c.class_name,
      subject: subjects.labelOf(c.subject),
      subjectKey: c.subject ?? "",
      startTime: startByClass.get(c.id) ?? null,
      endTime: endByClass.get(c.id) ?? null,
      studentCount: countByClass.get(c.id) ?? 0,
      reportOptout: !!c.report_optout,
      delegated: c.delegated,
      ownerName: c.ownerName,
      delegatedAwayTo: c.delegatedAwayTo,
    }))
    .filter((c) => c.studentCount > 0)
    .sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));

  // ── 로스터 신호(G2·G3) 부착 — 학생 단위 부가정보. 조회 실패는 위에서 빈 배열로 흡수돼 배지만 침묵(로스터 무영향).
  // 판정(배지 여부)은 클라의 roster-signals.ts 순수 함수 — 여기선 통계만 싣는다.
  type ReadStatRow = {
    student_id: string;
    trackable_count: number;
    aged_unread_count: number;
    read_count: number;
    last_read_at: string | null;
  };
  const readBySid = new Map((readStats as ReadStatRow[]).map((r) => [r.student_id, r]));
  const [monthlyEvals, monthlyActivities] = await Promise.all([monthlyEvalsP, monthlyActivitiesP]);
  if (monthlyEvals.size || monthlyActivities.size) {
    for (const s of byStudent.values()) {
      for (const su of s.subjects) {
        const ev = su.classId ? monthlyEvals.get(`${su.classId}|${s.id}`) : undefined;
        if (ev) su.monthlyEval = ev;
        const act = su.classId ? monthlyActivities.get(`${su.classId}|${s.id}`) : undefined;
        if (act) su.monthlyActivity = act;
      }
    }
  }
  const anomalyCountBySid = new Map<string, number>();
  for (const e of anomalyEvents) anomalyCountBySid.set(e.student_id, (anomalyCountBySid.get(e.student_id) ?? 0) + 1);
  for (const s of byStudent.values()) {
    const rs = readBySid.get(s.id);
    if (rs && rs.trackable_count > 0)
      s.parentRead = {
        trackableCount: rs.trackable_count,
        agedUnreadCount: rs.aged_unread_count,
        readCount: rs.read_count,
        lastReadAt: rs.last_read_at,
      };
    const anomalyCount = anomalyCountBySid.get(s.id) ?? 0;
    if (anomalyCount > 0) s.progressSignal = { anomalyCount };
  }

  // 학생 정렬: 반(시각순) → 그 안에서 학년 → 이름. 좌측 목록이 반별로 묶이도록.
  // 그 위에 강사가 저장한 학생 순서(0116a)를 반 그룹 내부만 재배열(좌석·채점지 순서 — 미등재 학생은 기존 정렬 뒤).
  const classRank = new Map(todayClasses.map((c, i) => [c.name, i]));
  const students = applyStudentOrder(
    [...byStudent.values()].sort(
      (a, b) =>
        (classRank.get(a.className ?? "") ?? 999) - (classRank.get(b.className ?? "") ?? 999) ||
        gradeRank(a.grade) - gradeRank(b.grade) ||
        a.name.localeCompare(b.name, "ko"),
    ),
    orderByClass,
  );

  // 반별 필터 칩 = 전체 + 오늘 담당 반(시각순).
  const classTags = [CLASS_TAG_ALL, ...todayClasses.map((c) => c.name)];

  return {
    today,
    date: targetDate,
    classTags,
    teacherName,
    students,
    todayClasses,
    ...config,
    ...(makeupNotice ? { makeupNotice } : {}),
    noClassesToday,
    showingAll: noClassesToday && showAll,
  };
}
