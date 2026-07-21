import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { fetchInChunks } from "@/lib/supabase/batch";
import { addDays, resolveReportDate, weekdayIndexOf, formatKoreanDate } from "@/lib/date-kst";
import { parseExamScores } from "../exam-info";
import { classnoteSendWindowLabel } from "../classnote-guard";
import { applyStudentOrder } from "../student-order";
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
  todayClasses: TodayClass[]; // 오늘(또는 폴백 전체) 담당 반 — 시작시각순
  allowTeacherTestMax: boolean; // 강사가 테스트 문항수(/N) 직접 변경 허용(report 설정) — 원스크린 입력 UI 분기
  // 일일/확인테스트 사용 여부 = 보고서 '표시 항목' 토글(showDailyTest/showCheckTest) 재사용. off면 원스크린
  // 점수 입력칸을 숨겨(입력 안 함) + 학부모 보고서에도 미표시(parent-report-card). 표시·입력 단일 스위치.
  showDailyTest: boolean;
  showCheckTest: boolean;
  noticeMode: "A" | "B" | null; // 강사 본인의 AI 멘트 모드 오버라이드(null=학원 기본 따름) — 0104a
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드(report.noticeMode) — 토글 '학원 기본' 라벨 표시용
  classnoteSendEnabled: boolean; // ClassNote 실제 발송 스위치 — 공지 컴포저 dry-run 안내용
  // 발송 허용 시간창 라벨("HH:MM~HH:MM", 무제한=null) — 원스크린 상단 강사 참고 안내. 활성 판정은
  // classnoteSendWindowLabel(워커 fail-open 규약 미러). 빈 로스터는 발송 표면이 없어 null 고정.
  sendWindowLabel: string | null;
  // 사진/파일 첨부 표시(report.showAttachments) — off면 첨부는 저장되지만 /r·인쇄·ClassNote 어디에도 안 실린다.
  // 강사 카드가 첨부 칸에 그 사실을 경고로 띄운다(입력 시점 고지 = 거짓 약속 차단, 2026-07-21).
  showAttachments: boolean;
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
  attitude: string | null;
  homework: string | null;
  special_note: string | null;
  progress_confirmed: boolean | null;
};

function emptyRoster(
  today: string,
  date: string,
  teacherName: string,
  noticeMode: "A" | "B" | null = null,
  academyNoticeMode: "A" | "B" = "A",
): TeacherRoster {
  return {
    today,
    date,
    classTags: ["전체"],
    teacherName,
    students: [],
    todayClasses: [],
    allowTeacherTestMax: false,
    showDailyTest: true,
    showCheckTest: true,
    noticeMode,
    academyNoticeMode,
    classnoteSendEnabled: false,
    sendWindowLabel: null,
    showAttachments: true, // 빈 로스터는 첨부 표면이 없어 값 무의미 — 경고를 띄우지 않는 쪽으로 고정
  };
}

export async function getTeacherRoster(rawDate?: string): Promise<TeacherRoster> {
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
  const academyNoticeMode: "A" | "B" = settings.report.noticeMode ?? "A";

  // 1) 강사 담당 활성 반 + 본인 멘트 모드 + 학생 표시 순서(0116a, 강사×반 개인 설정) — 독립 조회 → 병렬(B4)
  const [{ data: classes }, { data: meRow }, { data: orderRows }] = await Promise.all([
    supabase.from("classes").select("id, class_name, subject").eq("teacher_id", user.id).eq("is_active", true),
    supabase.from("users").select("report_notice_mode").eq("id", user.id).single(),
    supabase.from("onescreen_student_order").select("class_id, student_ids").eq("teacher_id", user.id),
  ]);
  const orderByClass = new Map(
    (orderRows ?? []).map((r) => [r.class_id as string, (r.student_ids ?? []) as string[]]),
  );
  const noticeMode = ((meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? null);
  const allClasses = classes ?? [];
  if (allClasses.length === 0) return emptyRoster(today, targetDate, teacherName, noticeMode, academyNoticeMode);

  // 2) 오늘 요일에 수업 있는 반(없으면 전체 담당 반 폴백 — 주말/휴일에도 화면이 비지 않게)
  const allIds = allClasses.map((c) => c.id);
  const scheds = await fetchInChunks<{ class_id: string; start_time: string | null }>(allIds, (chunk) =>
    supabase
      .from("class_schedules")
      .select("class_id, start_time")
      .eq("day_of_week", dow)
      .in("class_id", chunk),
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
  const activeClasses = todayIds.size > 0 ? allClasses.filter((c) => todayIds.has(c.id)) : allClasses;
  const classById = new Map(activeClasses.map((c) => [c.id, c]));
  const activeIds = activeClasses.map((c) => c.id);

  // 3) 대상 날짜 시점 수강생 — start≤date AND (end null OR end≥date). null 양단 허용(레거시 안전).
  // ⚠️ end_date IS NULL 고정이면 과거 날짜 마감 시 그새 종료된 학생이 누락되고, 출결 write 게이트(날짜기준)와
  //    어긋나 pill 클릭이 거부된다(회귀). 출석부·setAttendanceCell과 같은 날짜 기준으로 통일.
  const enrollments = await fetchInChunks<{ student_id: string; class_id: string }>(activeIds, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, class_id")
      .or(`start_date.is.null,start_date.lte.${targetDate}`)
      .or(`end_date.is.null,end_date.gte.${targetDate}`)
      .in("class_id", chunk),
  );
  // 결정적 정렬(반 시작시각→class_id) — '대표 반'(tag=첫 반)·과목 행 순서를 새로고침 간 안정화(비결정 방지).
  enrollments.sort(
    (a, b) =>
      (startByClass.get(a.class_id) ?? "99:99").localeCompare(startByClass.get(b.class_id) ?? "99:99") ||
      a.class_id.localeCompare(b.class_id),
  );
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  if (studentIds.length === 0) return emptyRoster(today, targetDate, teacherName, noticeMode, academyNoticeMode);

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
    const dupSubject = os.subjects.find((su) => su.subjectKey === cls.subject);
    if (!dupSubject) {
      // classId = 이 과목 행의 반(출결 원장이 student+class+date라 행 단위 출결 입력(2단계)의 키).
      os.subjects.push({ name: subjects.labelOf(cls.subject), subjectKey: cls.subject, classId: cls.id, className: cls.class_name, prev: "", today: "", textbook: "", makeup: false, homeworkToday: "" });
    } else if (dupSubject.classId !== cls.id) {
      // 같은 과목을 두 반에서 수강(subjectKey dedup으로 1행) — 행의 반이 모호 → 출결 pill 숨김(출석부에서 기록).
      dupSubject.classId = null;
      dupSubject.className = null;
    }
  }

  // 이전 진도/점수(직전 회차) + 그날 발송 여부 + 그날 출결을 실데이터로 채운다(하드코딩 초기값 대체).
  // 셋 다 studentIds에만 의존하는 독립 조회 → Promise.all 병렬(B4). 전부 fetchInChunks(B2/B3).
  // 앵커 = 대상 날짜(오늘 또는 과거). session_date/report_date/attendance 필터가 모두 이 날짜.
  const todayIso = targetDate;
  const [todayReports, priorReports, attRows, sessionRows, textbookRows, readStats, anomalyEvents] = await Promise.all([
    // (a) 당일 행만 — 발송상태·공유링크·초안복원용. eq(report_date)라 학생×과목 소량(절단 불가).
    fetchInChunks<{
      id: string;
      student_id: string;
      subject: string | null;
      share_token: string | null;
      classnote_status: string | null;
      revoked_at: string | null;
      attachments: { path: string; name: string }[] | null;
      notes: string | null;
      trend_note: string | null;
    }>(
      studentIds,
      (chunk) =>
        supabase
          .from("lesson_reports")
          .select("id, student_id, subject, share_token, classnote_status, revoked_at, attachments, notes, trend_note")
          .eq("report_date", todayIso)
          .in("student_id", chunk),
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
          "student_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework, special_note, progress_confirmed",
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
        .gte("created_at", `${addDays(todayIso, -14)}T00:00:00+09:00`)
        .in("student_id", chunk),
    ).catch((e) => {
      console.error("[roster] progress_events 조회 실패 — 진도 이상 배지 생략:", e instanceof Error ? e.message : e);
      return [] as { student_id: string }[];
    }),
  ]);
  type PriorRow = {
    student_id: string;
    subject: string | null;
    report_date: string;
    progress: string | null;
    exam_info: string | null;
    textbook: string | null;
    homework_today: string | null;
    homework_score: string | null;
    attitude: string | null;
    notes: string | null;
  };
  // RPC 에러는 무신호 삼킴 금지(B2/B3) — 다만 이전회차는 '보강' 데이터라 throw로 화면 전체를 죽이지 않고 로그+graceful.
  // (0117a 미배포·일시장애 시 이전회차/prevScore/교재승계만 빠지고 당일 데이터·세션은 정상 렌더 → 진단 가능하게 로그.)
  if (priorReports.error)
    console.error("[roster] onescreen_prior_reports RPC 실패 — 이전 회차 데이터 생략:", priorReports.error.message);
  const priorRows = (priorReports.data ?? []) as PriorRow[];
  const sessionById = new Map(sessionRows.map((r) => [r.student_id, r]));

  // 학생별 대표 교재 — 강사 본인 주문 우선, (requestDate ?? createdAt) 최신, book_name 공란 제외.
  // 교재요청서엔 과목 컬럼이 없어 (학생) 단위 대표 1건을 그 학생의 과목들에 기본값으로 적용(강사가 세션에서 덮어씀).
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
  // 오늘 보고서는 **과목별**로도 적재(sentToday는 학생단위 폴백, todayBySubject는 과목별 발송상태·공유링크 수명).
  const sentToday = new Set<string>();
  const todayBySubject = new Map<
    string,
    {
      reportId: string;
      shareToken: string | null;
      classnoteStatus: string | null;
      revokedAt: string | null;
      attachments: { path: string; name: string }[];
      notes: string | null; // 발송본 멘트 — 세션 초안 없을 때 초안 복원 폴백
      trendNote: string | null; // 발송본 학습 추세 — 동일 폴백
    }
  >();
  const subjKey = (studentId: string, subject: string | null) => `${studentId}::${subject ?? ""}`;
  // 학생단위 직전(prev 진도·prevScore 폴백) = 그 학생 과목행들 중 최신 회차.
  const priorReport = new Map<string, { progress: string | null; examInfo: string | null; date: string }>();
  // (학생×과목)별 직전 회차 — 이전 회차 참고행(prevReport). RPC가 이미 (학생,과목) 최신 1건씩 반환.
  const priorBySubject = new Map<string, PriorRow>();
  const todayReportIds: string[] = [];
  // (a) 당일 행 — 발송상태·과목별 공유링크·초안 복원.
  for (const r of todayReports) {
    sentToday.add(r.student_id);
    const k = subjKey(r.student_id, r.subject);
    if (!todayBySubject.has(k)) {
      todayBySubject.set(k, {
        reportId: r.id,
        shareToken: r.share_token,
        classnoteStatus: r.classnote_status,
        revokedAt: r.revoked_at,
        attachments: r.attachments ?? [],
        notes: r.notes,
        trendNote: r.trend_note,
      });
      todayReportIds.push(r.id);
    }
  }
  // (b) 직전 회차(RPC, 대상 날짜 이전 최신) — 참고행 + 학생단위 최신.
  for (const r of priorRows) {
    const pk = subjKey(r.student_id, r.subject);
    if (!priorBySubject.has(pk)) priorBySubject.set(pk, r);
    const cur = priorReport.get(r.student_id);
    if (!cur || r.report_date > cur.date)
      priorReport.set(r.student_id, { progress: r.progress, examInfo: r.exam_info, date: r.report_date });
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
    // 과목별 오늘 발송상태 — report.subject ↔ subject.subjectKey 매칭(학생단위 뭉갬 방지).
    for (const su of os.subjects) {
      const t = todayBySubject.get(subjKey(os.id, su.subjectKey ?? null));
      if (t) {
        su.reportSent = true;
        su.shareToken = t.shareToken ?? undefined;
        su.classnoteStatus = t.classnoteStatus ?? undefined;
        su.revokedAt = t.revokedAt ?? undefined;
        su.viewCount = viewCountByReport.get(t.reportId) ?? 0;
        su.attachments = t.attachments;
        // 발송본 멘트/추세 = 초안 복원 폴백 — 아래 세션 블록이 비어있지 않은 세션 초안으로 덮음(작업중 편집 우선).
        if (t.notes) su.draft = t.notes;
        if (t.trendNote) su.trendDraft = t.trendNote;
      }
    }
    os.attendance = toMark(attById.get(os.id));
    // 행(반) 단위 raw 출결 — 출결 pill(2단계). classId 모호(null)면 미채움=pill 숨김.
    for (const su of os.subjects) {
      if (su.classId) su.attendanceRaw = attByRow.get(`${os.id}::${su.classId}`) ?? null;
    }
    const pr = priorReport.get(os.id);
    if (pr) {
      const { daily, check } = parseExamScores(pr.examInfo);
      os.tests.daily.prevScore = daily;
      os.tests.check.prevScore = check;
      if (pr.progress) {
        // 이전 진도 텍스트("수학 1-1-2 …")를 과목명 접두로 매칭 → 그 과목 prev. 폴백=첫 과목.
        let matched = false;
        for (const su of os.subjects) {
          if (su.name && pr.progress.startsWith(su.name)) {
            su.prev = pr.progress.slice(su.name.length).trim() || pr.progress;
            matched = true;
          }
        }
        if (!matched && os.subjects[0]) os.subjects[0].prev = pr.progress;
      }
    }
    // (학생×과목) 직전 회차 → 참고행(prevReport) + 과목 정확매칭 prev + 교재 자동입력 기본값(②교재요청서 > ③직전교재).
    // ①오늘 입력값(세션)은 아래 sess 블록이 최종으로 덮으므로 항상 우선. su.textbook 초기값은 ""(과목 push).
    const reqBook = bookByStudent.get(os.id);
    for (const su of os.subjects) {
      const pbs = priorBySubject.get(subjKey(os.id, su.subjectKey ?? null));
      if (pbs) {
        const prog =
          pbs.progress && su.name && pbs.progress.startsWith(su.name)
            ? pbs.progress.slice(su.name.length).trim() || pbs.progress
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
      }
      const prevBook = su.prevReport?.textbook?.trim();
      if (prevBook) su.textbook = prevBook; // ③ 직전 교재
      if (reqBook) su.textbook = reqBook; // ② 교재요청서(덮음)
    }
    // Phase3: 오늘 세션(작업중) 복원 — 점수/진도/태도/과제/확정을 하드코딩 기본값 위에 덮어씀.
    const sess = sessionById.get(os.id);
    if (sess) {
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
      for (const su of os.subjects) {
        const entry = sp[su.subjectKey || su.name];
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
    allowTeacherTestMax,
    showDailyTest,
    showCheckTest,
    noticeMode,
    academyNoticeMode,
    classnoteSendEnabled: settings.report.classnoteSendEnabled,
    sendWindowLabel: classnoteSendWindowLabel(
      settings.report.classnoteSendWindowStart,
      settings.report.classnoteSendWindowEnd,
    ),
    showAttachments: settings.report.showAttachments,
  };
}
