import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, resolveReportDate, weekdayIndexOf, formatKoreanDate } from "@/lib/date-kst";
import { parseExamScores, parseExamMaxes } from "../exam-info";
import { classnoteSendWindowLabel } from "../classnote-guard";
import { applyStudentOrder } from "../student-order";
import { rosterIncludesEnrollment } from "../roster-filter";
import { matchReportsToRows } from "../report-unit";
import { LEGACY_REPORT_SUBJECT, reportSubject } from "@/features/timetable/lib/report-subject";
import { carryProgress } from "../progress-status";
import {
  DEFAULT_ONESCREEN_FONT_SIZE,
  readOnescreenFontSize,
  type OnescreenFontSize,
} from "../font-size";
import { getTextbookOrdersForStudents } from "@/features/billing/server/textbook-queries";
import type { AttendanceMark, OneScreenStudent } from "../types";

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
  subject: string;
  startTime: string | null; // "16:20"
  studentCount: number;
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
  allowTeacherTestMax: boolean; // 강사가 테스트 문항수(/N) 직접 변경 허용(report 설정) — 원스크린 입력 UI 분기
  // 일일/확인테스트 사용 여부 = 보고서 '표시 항목' 토글(showDailyTest/showCheckTest) 재사용. off면 원스크린
  // 점수 입력칸을 숨겨(입력 안 함) + 학부모 보고서에도 미표시(parent-report-card). 표시·입력 단일 스위치.
  showDailyTest: boolean;
  showCheckTest: boolean;
  noticeMode: "A" | "B" | null; // 강사 본인의 AI 멘트 모드 오버라이드(null=학원 기본 따름) — 0104a
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드(report.noticeMode) — 토글 '학원 기본' 라벨 표시용
  classnoteSendEnabled: boolean; // ClassNote 실제 발송 스위치 — 공지 컴포저 dry-run 안내용
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
};

type OnescreenSessionRow = {
  student_id: string;
  study_grade: string | null;
  subject_progress: Record<
    string,
    { today?: string; draft?: string; trendDraft?: string; textbook?: string; makeup?: boolean; homeworkToday?: string }
  > | null;
  daily_score: number | null;
  daily_max: number | null;
  check_score: number | null;
  check_max: number | null;
  daily_score_mode: string | null; // 0148a — 점수 표기 모드 오버라이드(score|count)
  check_score_mode: string | null;
  attitude: string | null;
  homework: string | null;
  special_note: string | null;
  progress_confirmed: boolean | null;
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
  | "sendWindow"
  | "showAttachments"
  | "canEditAttendance"
  | "fontSize"
>;
type RosterConfig = Partial<RosterSettings & Pick<TeacherRoster, "noClassesToday" | "showingAll">>;

/**
 * 빈 로스터(학생 0명).
 *
 * ⚠️ 학원설정에서 온 값(테스트 표시·첨부·발송 시간창·발송 스위치)은 **반드시 그대로 실어라** — 하드코딩 금지.
 * 이 경로는 '그 요일에 담당 수업 없음'에서도 오는데, 그 화면에서도 강사는 상단 '+ 보강 학생 추가'로 학생을
 * 넣어 보고서를 쓰고 발송한다(보강은 요일과 무관 — 서버 게이트도 outOfClass로 열려 있다, 2026-07-22 확인).
 * 값을 하드코딩하면 **그 보강 행만** 학원설정을 무시한다(발송 시간대 안내 증발, 꺼둔 테스트칸·첨부칸 노출).
 * 그래서 기본값은 "설정을 아직 못 읽은 경우"(비로그인)용이고, 읽은 뒤엔 항상 config로 덮어쓴다.
 */
function emptyRoster(today: string, date: string, teacherName: string, config: RosterConfig = {}): TeacherRoster {
  return {
    today,
    date,
    classTags: ["전체"],
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
    sendWindow: null,
    showAttachments: true,
    canEditAttendance: false,
    fontSize: DEFAULT_ONESCREEN_FONT_SIZE,
    ...config,
  };
}

export async function getTeacherRoster(rawDate?: string, showAll = false): Promise<TeacherRoster> {
  // 대상 날짜 = 고른 날짜(YYYY-MM-DD) 클램프(미래·형식오류→오늘). 요일·표시·데이터 앵커를 **모두 이 날짜**로
  // 통일(옛 코드는 요일=서버 로컬 now.getDay(), 데이터=KST kstToday()로 어긋날 수 있었음 — 함께 교정).
  const targetDate = resolveReportDate(rawDate);
  const today = formatKoreanDate(targetDate);
  const dow = DOW_KEY[weekdayIndexOf(targetDate)];

  const user = await getCurrentUser();
  if (!user) return emptyRoster(today, targetDate, "");
  const teacherName = user.displayName ?? "";

  const supabase = await createClient();
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gradeOrder = settings.operations.gradeLevels;
  // 과목별 테스트 문항수(만점) — 원스크린 점수 입력 /N 기본값. 미설정 과목은 5.
  const subjectTestMax = new Map(settings.operations.subjects.map((su) => [su.key, su.testMax ?? 5]));
  const allowTeacherTestMax = settings.report.allowTeacherTestMax;
  const { showDailyTest, showCheckTest } = settings.report;
  // 테스트 점수 표기 모드(0148a) 학원 기본 — 세션에 오버라이드가 없으면 이 값이 출발점(문항수 시드와 같은 층).
  const dailyModeDefault: "score" | "count" = settings.report.dailyTestScoreMode ?? "count";
  const checkModeDefault: "score" | "count" = settings.report.checkTestScoreMode ?? "count";
  const academyNoticeMode: "A" | "B" = settings.report.noticeMode ?? "A";

  // 1) 강사 담당 활성 반 + 본인 멘트 모드 + 학생 표시 순서(0116a, 강사×반 개인 설정) + 출결 쓰기 권한
  //    — 서로 독립이라 병렬(B4).
  const [{ data: classes }, { data: meRow }, { data: orderRows }, canEditAttendance] = await Promise.all([
    supabase.from("classes").select("id, class_name, subject, is_special").eq("teacher_id", user.id).eq("is_active", true),
    supabase.from("users").select("report_notice_mode, ui_prefs").eq("id", user.id).single(),
    supabase.from("onescreen_student_order").select("class_id, student_ids").eq("teacher_id", user.id),
    canWriteTenant(user.systemRole, "attendance"),
  ]);
  const orderByClass = new Map(
    (orderRows ?? []).map((r) => [r.class_id as string, (r.student_ids ?? []) as string[]]),
  );
  const noticeMode = ((meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? null);
  const fontSize = readOnescreenFontSize(meRow?.ui_prefs);

  // 학원설정·강사설정에서 온 값 — 빈 로스터를 포함해 **모든 반환 경로가 이걸 그대로 쓴다**(emptyRoster 주석 참조).
  const config: RosterSettings = {
    allowTeacherTestMax,
    showDailyTest,
    showCheckTest,
    noticeMode,
    academyNoticeMode,
    classnoteSendEnabled: settings.report.classnoteSendEnabled,
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
  };

  const allClasses = classes ?? [];
  if (allClasses.length === 0) return emptyRoster(today, targetDate, teacherName, config);

  // 2) 오늘 요일에 수업 있는 반(없으면 전체 담당 반 폴백 — 주말/휴일에도 화면이 비지 않게)
  const allIds = allClasses.map((c) => c.id);
  // ⚠️ **그 날짜에 유효한 스케줄만**. 예전엔 valid_from/valid_to를 안 봐서 만료된 배치가 계속 "오늘 수업"으로
  //    잡혔다 — 특강처럼 기간이 정해진 반(실측: 특강 4반 전부 valid_to 08-07~08-31, 수강행은 대부분 무기한)이
  //    종료일 뒤에도 로스터에 영원히 남는다. 시간표(fetchSlots)와 같은 규약으로 맞춘다.
  const scheds = await fetchInChunks<{ class_id: string; start_time: string | null }>(allIds, (chunk) =>
    supabase
      .from("class_schedules")
      .select("class_id, start_time")
      .eq("day_of_week", dow)
      .in("class_id", chunk)
      .or(`valid_from.is.null,valid_from.lte.${targetDate}`)
      .or(`valid_to.is.null,valid_to.gte.${targetDate}`),
  );
  const todayIds = new Set(scheds.map((s) => s.class_id));
  // 반별 오늘 최초 시작시각(HH:MM)
  const startByClass = new Map<string, string | null>();
  for (const s of scheds) {
    const t = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = startByClass.get(s.class_id);
    if (prev === undefined) startByClass.set(s.class_id, t);
    else if (t && (prev === null || t < prev)) startByClass.set(s.class_id, t);
  }
  // ⚠️ 그 요일에 수업이 없으면 **비운다** — 옛 코드는 담당 반 전체로 조용히 폴백해, 수요일 수업이 없는
  // 강사에게 담당 반 7개·학생 37명을 "오늘 목록"처럼 보여줬다(2026-07-22 이수진 사례, 타입 주석 참조).
  // 전체 보기는 남기되 **강사가 명시로 고를 때만**(showAll) — 그때는 화면이 "전체 보기 중"임을 밝힌다.
  // ⚠️ 빈 목록이어도 학원설정(config)은 그대로 실어 보낸다 — 이 화면에서도 '+ 보강 학생 추가'로 발송이 가능하다.
  const noClassesToday = todayIds.size === 0;
  if (noClassesToday && !showAll) {
    return emptyRoster(today, targetDate, teacherName, { ...config, noClassesToday: true });
  }
  const activeClasses = noClassesToday ? allClasses : allClasses.filter((c) => todayIds.has(c.id));
  const classById = new Map(activeClasses.map((c) => [c.id, c]));
  const activeIds = activeClasses.map((c) => c.id);

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
    rosterIncludesEnrollment(e, targetDate, dow, todayIds.size > 0),
  );
  // 결정적 정렬(반 시작시각→class_id) — '대표 반'(tag=첫 반)·과목 행 순서를 새로고침 간 안정화(비결정 방지).
  enrollments.sort(
    (a, b) =>
      (startByClass.get(a.class_id) ?? "99:99").localeCompare(startByClass.get(b.class_id) ?? "99:99") ||
      a.class_id.localeCompare(b.class_id),
  );
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  if (studentIds.length === 0)
    return emptyRoster(today, targetDate, teacherName, {
      ...config,
      noClassesToday,
      showingAll: noClassesToday && showAll,
    });

  // 4) 학생 기본 정보
  const studentRows = await fetchInChunks<{ id: string; name: string; grade: string | null }>(
    studentIds,
    (chunk) => supabase.from("students").select("id, name, grade").in("id", chunk),
  );
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
        tag: cls.class_name, // 반별 필터(반 이름 기준)
        className: cls.class_name,
        classId: cls.id,
        attendance: "출석",
        subjects: [],
        tests: {
          // 모드(0148a) 학원 기본으로 시드 — 아래 승계·세션복원이 있으면 덮어씀. 점수 모드의 만점은 100 고정(v1).
          daily: { score: null, max: dailyModeDefault === "score" ? 100 : tmax, prevScore: null, mode: dailyModeDefault },
          check: { score: null, max: checkModeDefault === "score" ? 100 : tmax, prevScore: null, mode: checkModeDefault },
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
      os.subjects.push({ name: label, subjectLabel: label, subjectKey: cls.subject, classId: cls.id, className: cls.class_name, isSpecial: !!cls.is_special, prev: "", today: "", textbook: "", makeup: false, homeworkToday: "" });
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
    }>(
      studentIds,
      (chunk) =>
        supabase
          .from("lesson_reports")
          .select("id, student_id, subject, class_id, makeup, share_token, classnote_status, classnote_read_at, revoked_at, attachments, notes, trend_note")
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
    fetchInChunks<{ student_id: string; class_id: string; status: string; recorded_at: string }>(
      studentIds,
      (chunk) =>
        supabase
          .from("attendance_records")
          .select("student_id, class_id, status, recorded_at")
          .eq("session_date", todayIso)
          .in("student_id", chunk)
          .order("recorded_at", { ascending: false }),
    ),
    // Phase3: 오늘 "작업중" 세션(점수/진도/태도/과제/확정) 복원 — 새로고침에도 유지.
    // ⚠️ 강사축(0118a): 같은 학생을 다른 강사가 가르쳐도 서로 안 덮게 updated_by=본인 세션만 복원.
    fetchInChunks<OnescreenSessionRow>(studentIds, (chunk) =>
      supabase
        .from("onescreen_daily_sessions")
        .select(
          "student_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, daily_score_mode, check_score_mode, attitude, homework, special_note, progress_confirmed",
        )
        .eq("session_date", todayIso)
        .eq("updated_by", user.id)
        .in("student_id", chunk),
    ),
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
    //  ⚠️ 조회는 **항상** 돈다 — 표기 모드(0148a)는 문항수 권한과 무관하게 항상 승계해야 하기 때문(원장 요구:
    //     "한번 정한 점수/개수 토글은 다음 보고서로 이어짐"). 단 **문항수(max) 시드만** allowTeacherTestMax로
    //     게이트한다(off의 계약="과목 설정값 고정"). 모드 시드는 게이트 없음.
    fetchAllPagedInChunks<{
      student_id: string;
      session_date: string;
      daily_max: number | null;
      check_max: number | null;
      daily_score_mode: string | null;
      check_score_mode: string | null;
    }>(
      studentIds,
      (chunk, from, to) =>
        supabase
          .from("onescreen_daily_sessions")
          .select("student_id, session_date, daily_max, check_max, daily_score_mode, check_score_mode")
          .eq("updated_by", user.id)
          .lt("session_date", todayIso)
          .gte("session_date", testMaxFrom)
          .in("student_id", chunk)
          // 최신 우선 + unique tie-break(student_id) — 페이지가 흔들리지 않게(fetchAllPagedInChunks 계약).
          .order("session_date", { ascending: false })
          .order("student_id", { ascending: true })
          .range(from, to),
    ).catch((e) => {
      console.error("[roster] 문항수·모드 승계 조회 실패 — 학원 설정값 사용:", e instanceof Error ? e.message : e);
      return [] as {
        student_id: string;
        session_date: string;
        daily_max: number | null;
        check_max: number | null;
        daily_score_mode: string | null;
        check_score_mode: string | null;
      }[];
    }),
  ]);
  const seededDailyMax = new Set<string>();
  const seededCheckMax = new Set<string>();
  // ⚠️ 모드용 가드 Set은 max와 **분리**한다 — max는 있는데 mode가 null인 과거 행에서 max Set을 재사용하면
  //    그 학생을 조기 seeded 처리해 더 오래된 행의 mode를 못 물려받는 미묘한 버그가 난다.
  const seededDailyMode = new Set<string>();
  const seededCheckMode = new Set<string>();
  const asMode = (v: string | null): "score" | "count" | null =>
    v === "score" || v === "count" ? v : null;
  // 학생별 **가장 최근** 값(정렬 최신순 → 처음 만난 값이 직전 값) → 오늘의 기본값으로 승계.
  // 오늘 세션이 있으면 아래 Phase3 복원이 다시 덮으므로, 여기서 넣는 건 "오늘 아직 안 건드린 행"의 출발값이다.
  for (const r of priorMaxRows) {
    const os = byStudent.get(r.student_id);
    if (!os) continue;
    // 문항수 승계 — allowTeacherTestMax on일 때만(off=과목 설정값 고정). 점수 모드 만점(100)은 아래 normalize가 고정.
    if (allowTeacherTestMax && r.daily_max != null && !seededDailyMax.has(r.student_id)) {
      os.tests.daily.max = r.daily_max;
      seededDailyMax.add(r.student_id);
    }
    if (allowTeacherTestMax && r.check_max != null && !seededCheckMax.has(r.student_id)) {
      os.tests.check.max = r.check_max;
      seededCheckMax.add(r.student_id);
    }
    // 표기 모드 승계 — **항상**(원장 요구). 유효값(score|count)만.
    const dm = asMode(r.daily_score_mode);
    if (dm && !seededDailyMode.has(r.student_id)) {
      os.tests.daily.mode = dm;
      seededDailyMode.add(r.student_id);
    }
    const cm = asMode(r.check_score_mode);
    if (cm && !seededCheckMode.has(r.student_id)) {
      os.tests.check.mode = cm;
      seededCheckMode.add(r.student_id);
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
  // student별 오늘 최신 출결 status(recorded_at desc라 첫 건이 최신) — 학생 배지 표시용(축약).
  // ⚠️ 강사 담당 반 기록만(myClassIdSet) — 타 강사·타 반의 그날 기록을 집으면 이 화면 배지가 행 pill과 모순된다.
  const myClassIdSet = new Set(allIds); // 강사 담당 전 반
  const attById = new Map<string, string>();
  for (const a of attRows)
    if (myClassIdSet.has(a.class_id) && !attById.has(a.student_id)) attById.set(a.student_id, a.status);
  // (학생×반) 최신 raw — 출결 pill(2단계)의 행 단위 값. 축약(toMark)과 별개로 raw 보존(조퇴·보강 되쓰기 방지).
  const attByRow = new Map<string, string>();
  for (const a of attRows) {
    const k = `${a.student_id}::${a.class_id}`;
    if (!attByRow.has(k)) attByRow.set(k, a.status);
  }
  const toMark = (status: string | undefined): AttendanceMark =>
    status === "late" ? "지각" : status === "absent" || status === "early_leave" ? "결석" : "출석";

  for (const os of byStudent.values()) {
    os.reportSent = sentToday.has(os.id);
    // 행(반)별 오늘 보고서 — 반 정확매칭 우선, 반 없는 행은 과목으로 **1:1** 폴백(matchReportsToRows).
    // ⚠️ 한 보고서를 두 행에 붙이면 두 행의 저장이 서로를 덮는다 → 소비형 매칭이 불변식이다.
    const todayMatched = matchReportsToRows(
      os.subjects.map((su) => ({ classId: su.classId ?? null, subjectKey: su.subjectKey ?? null, isSpecial: su.isSpecial })),
      (todayByStudent.get(os.id) ?? []).map((r) => ({ ...r, classId: r.class_id })),
    );
    os.subjects.forEach((su, i) => {
      const t = todayMatched[i];
      if (!t) return;
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
    os.attendance = toMark(attById.get(os.id));
    // 행(반) 단위 raw 출결 — 출결 pill(2단계). classId 모호(null)면 미채움=pill 숨김.
    for (const su of os.subjects) {
      if (su.classId) su.attendanceRaw = attByRow.get(`${os.id}::${su.classId}`) ?? null;
    }
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
      os.subjects.map((su) => ({ classId: su.classId ?? null, subjectKey: su.subjectKey ?? null, isSpecial: su.isSpecial })),
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
      const prevBook = su.prevReport?.textbook?.trim();
      if (prevBook) su.textbook = prevBook; // ③ 직전 교재(과목 매칭된 prevReport라 이미 그 과목 것)
      // ② 교재요청서(덮음) — **math 행에만**. 과목 컬럼이 없어 영어 행에 주면 수학 교재가 영어 보고서
      //    교재명 칸에 **미리 채워진 채** 저장·발송된다(실측: 영어 행에 '초5-2 발전 1권'·'가우스 중1-1 2권').
      if (reqBook && (su.subjectKey?.trim() || LEGACY_REPORT_SUBJECT) === LEGACY_REPORT_SUBJECT)
        su.textbook = reqBook;
    });
    // Phase3: 오늘 세션(작업중) 복원 — 점수/진도/태도/과제/확정을 하드코딩 기본값 위에 덮어씀.
    const sess = sessionById.get(os.id);
    if (sess) {
      if (sess.study_grade) os.studyGrade = sess.study_grade;
      if (sess.daily_score != null) os.tests.daily.score = sess.daily_score;
      if (sess.daily_max != null) os.tests.daily.max = sess.daily_max;
      if (sess.check_score != null) os.tests.check.score = sess.check_score;
      if (sess.check_max != null) os.tests.check.max = sess.check_max;
      // 표기 모드 복원(0148a) — 저장 세션이 시드·승계를 최종으로 덮는다(문항수와 대칭). 만점 100 고정은 아래 normalize.
      const sdm = asMode(sess.daily_score_mode);
      if (sdm) os.tests.daily.mode = sdm;
      const scm = asMode(sess.check_score_mode);
      if (scm) os.tests.check.mode = scm;
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
        const byClass = su.classId ? sp[su.classId] : undefined;
        const legacyKey = su.subjectKey || su.name;
        let entry = byClass;
        if (!entry && !legacyTaken.has(legacyKey)) {
          entry = sp[legacyKey];
          if (entry) legacyTaken.add(legacyKey);
        }
        if (entry?.today) su.today = entry.today;
        if (entry?.textbook != null) su.textbook = entry.textbook;
        if (entry?.makeup != null) su.makeup = entry.makeup;
        if (entry?.homeworkToday != null) su.homeworkToday = entry.homeworkToday;
        // 미발송 멘트/추세 초안 복원 — 세션에 실제 텍스트가 있을 때만 발송본 폴백 위에 덮는다.
        // (lesson_reports엔 updated_at이 없어 신구 비교 불가 → 빈 세션 초안은 발송본 복원을 지우지 않음.)
        if (entry?.draft?.trim()) su.draft = entry.draft;
        if (entry?.trendDraft?.trim()) su.trendDraft = entry.trendDraft;
      }
    }
    // 점수 모드의 만점 = v1에서 **100 고정** — 시드·승계·세션복원 어느 경로로 mode가 정해졌든 max를 일관되게 맞춘다.
    // (개수 모드는 문항수 그대로.) 이걸 안 하면 개수 세션에서 승계된 max로 "95/5점" 같은 어긋남이 난다.
    if (os.tests.daily.mode === "score") os.tests.daily.max = 100;
    if (os.tests.check.mode === "score") os.tests.check.max = 100;
    // ⚠️ 척도 경계에서 prevScore 폐기(2026-07-24 적대검수): 직전 회차의 척도(exam_info 분모)가 오늘의 max와
    //    다르면(개수 20문항 ↔ 점수 100점) prevScore를 그대로 빼면 "▲77" 같은 허위 증감이 학부모에게 나간다.
    //    척도가 같을 때만 유지(같은 척도의 직전 회차가 쌓이면 다음 회차부터 정상 복원). 원장 롤아웃 당일 전 학생 커버.
    const prMax = parseExamMaxes(pr?.examInfo);
    if (prMax.daily != null && prMax.daily !== os.tests.daily.max) os.tests.daily.prevScore = null;
    if (prMax.check != null && prMax.check !== os.tests.check.max) os.tests.check.prevScore = null;
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
      startTime: startByClass.get(c.id) ?? null,
      studentCount: countByClass.get(c.id) ?? 0,
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
  const classTags = ["전체", ...todayClasses.map((c) => c.name)];

  return {
    today,
    date: targetDate,
    classTags,
    teacherName,
    students,
    todayClasses,
    ...config,
    noClassesToday,
    showingAll: noClassesToday && showAll,
  };
}
