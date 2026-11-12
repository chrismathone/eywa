import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { getTodaySchedule, getWeeklySchedule, getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { fetchReportOptoutClassIds } from "@/features/classes/server/report-optout-ids";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { absentClassKeysOf, judgeTodayLessonReports } from "@/features/dashboard/today-actions";
import { isReportTrackedSubject } from "@/features/dashboard/report-subjects";
import { needsAttention, summarizeQueue, type QueueSummary, HUMAN_RESOLVED_STATUSES } from "../classnote-queue";
import { classnoteMinDate } from "@/features/onescreen/classnote-guard";
import { absenceKeyOf, getAbsenceBlockedKeys } from "@/features/onescreen/server/absence-gate";
import { filterUnsentSendable, type UnsentRow } from "../unsent-sendable";
import { mentSourceColumnReady } from "@/features/onescreen/server/ment-source-db";
// 임시 위임(0173a) — 위임된 (반, 날짜)의 대상(분모)을 대체 강사로 옮기는 순수 규칙.
import { buildDelegateAttribution, type DelegateAttribution } from "../writing-rate-delegation";
import {
  extractWorkerEnv,
  formatWorkerResults,
  workerSupportsNativePublish,
  type WorkerEnvInfo,
  type WorkerResultRow,
} from "../worker-results";
import {
  computeWritingRates,
  type TeacherRate,
  type TodayTarget,
  type DailyTarget,
  type TodayPending,
} from "../writing-rate";
import {
  computeEnglishRates,
  foldByTeacher,
  type Dow,
  type EnglishClassInput,
} from "../english-writing";
import { buildHasStudentsOn, type ClassEnrollmentRow } from "../english-class-presence";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";

/**
 * 대상(분모) 산출용 수강 행 — **그 날 실제로 오는 학생만** 세려면 기간·휴원·분리등원을 다 봐야 한다.
 * ⚠️ 옛 구현은 `.is("end_date", null)`만 봐서 그 요일에 안 오는 분리등원 학생까지 분모에 넣었다
 * (실측 2026-07-21 화: 김윤하 21→18, 이수진 14→11). 판정은 enrollments/eligibility 단일 소스로.
 */
type TargetEnrollment = {
  student_id: string;
  class_id: string;
  start_date: string;
  end_date: string | null;
  on_hold: boolean;
  is_transferred: boolean | null;
  attendance_days: string[] | null;
};
const TARGET_ENROLLMENT_COLS =
  "student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days";

/** 기준일에 그 반 수업을 실제로 듣는 수강인지 — 기간(반이동 규약 포함)·휴원·분리등원 요일. */
function attendsOn(e: TargetEnrollment, date: string): boolean {
  return (
    isEnrollmentActiveOn(
      { startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred === true },
      date,
    ) && enrollmentAttendsOnDay(e.attendance_days, weekdayKeyOf(date))
  );
}

// 날짜(YYYY-MM-DD) → 요일 키("mon"~"sun") — 주간 스케줄 dayOfWeek와 매칭(결정적 UTC).
const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayKeyOf = (ymd: string): string => DOW_KEY[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;

/** KST 날짜에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 작성률 예외 강사 후보 — class_schedules에서 모은 강사 라벨(getTeacherLabelsBySubject)을 **활성 직원 목록
 * (users.status≠inactive = /staff에 보이는 사람)으로 필터**해 반환한다. 영어 슬롯 닉네임(Dom·Ellen…)·보조T·
 * 부원장·LAB 같은 users에 없는 자유입력 라벨과 퇴사(inactive) 직원은 후보에서 뺀다 — 예외 지정은 실재 직원에게만
 * 의미가 있고, 퇴사자는 이미 작성률에서 자동 제외되기 때문(getWeeklyWritingRates). staffNames는 report-section이
 * orphan(설정에만 남은 예외 이름)도 활성 직원으로 좁히는 데 쓴다(비직원 이름이 orphan으로 몰리는 것 방지).
 */
export async function getReportTeacherCandidates(): Promise<{
  bySubject: Record<string, string[]>;
  staffNames: string[];
}> {
  const supabase = await createClient();
  // users는 단일 테넌트 직원 표라 ≤ 수십 행 — 무페이징 select 안전(B2 규칙 예외, getStaffList와 동일 패턴).
  const [labels, staffRes] = await Promise.all([
    getTeacherLabelsBySubject(),
    supabase.from("users").select("display_name").neq("status", "inactive"),
  ]);
  const staffSet = new Set(
    (staffRes.data ?? [])
      .map((u) => (u.display_name as string | null)?.trim())
      .filter((n): n is string => !!n),
  );
  const bySubject: Record<string, string[]> = {};
  for (const [subject, names] of Object.entries(labels)) {
    const filtered = names.filter((n) => staffSet.has(n));
    if (filtered.length > 0) bySubject[subject] = filtered;
  }
  return { bySubject, staffNames: [...staffSet] };
}

export type QueueItem = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  status: string | null;
  error: string | null;
  processingAt: string | null;
  shareToken: string | null;
};

export type WorkerStatus = {
  hostname: string;
  lastSeenMinutes: number;
  online: boolean;
  /** 폴러별 마지막 실행 요약(0123a last_results → 한글 표시행). 구워커(컬럼 미기록)는 빈 배열. */
  results: WorkerResultRow[];
  /** 워커 실행환경(로그 폴더·최근 경고) — 연동 PC가 다른 컴퓨터라 웹에서 보이게. 구워커는 빈 값. */
  env: WorkerEnvInfo;
  /**
   * 자체 게시(Cloud Run 미사용) 버전인가 — false면 **edutrix Firebase 소등 시 이 PC의 발송이 전부 실패**한다.
   * zip 이관 여부를 원격에서 확인하는 유일한 신호(2026-07-29). 구워커는 키가 없어 false.
   */
  nativePublish: boolean;
};

export type ClassnoteQueueView = {
  summary: QueueSummary;
  items: QueueItem[]; // 주의 필요(실패·오래됨·동명이인·멈춤) 목록 — 상한 100
  pending: QueueItem[]; // 진행 중(대기·처리중, 정상 흐름) 목록 — 상한 100
  workers: WorkerStatus[];
  /**
   * 이 뷰를 만든 **서버 시각**(epoch ms). 화면이 워커 알림의 경과("10시간 전")를 계산하는 기준.
   * ⚠️ 클라에서 `Date.now()`를 부르지 않는 이유 둘: ① React 19 purity 룰(렌더 중 비순수 호출 금지)
   *    ② 연동 PC·서버·브라우저 시계가 서로 다를 수 있어 **서버 기준**이 유일하게 일관된다.
   */
  nowMs: number;
  since: string; // 집계 시작일
  days: number;
  sendEnabled: boolean; // ClassNote 실제 발송 스위치(false=dry-run, 재발송이 실제 전송 안 함)
  /**
   * 최근 30일 안에서 **재발송 기한(7일)까지 넘겨** 영영 못 나간 실패 건수. 0이면 화면에 안 띄운다.
   * 🔴 이 숫자는 "이미 잃은 것"이라 되살릴 수 없다 — 그래서 목록이 아니라 **경고 한 줄**로만 띄우고,
   * 원장이 볼 곳은 아직 살릴 수 있는 위 주의 목록이다(같은 학생이 계속 실패하면 원인이 안 고쳐진 것).
   */
  expiredUnsent: number;
  /** 오늘(KST) — 화면이 각 행의 재발송 남은 날을 계산하는 기준. 클라 시계를 믿지 않는다(nowMs와 같은 취지). */
  todayKst: string;
  /**
   * **저장만 되고 아직 발송 이력이 없는 보고서**(classnote_status IS NULL) 중 지금 보낼 수 있는 건수.
   *
   * 🔴 위 `summary`(대기·처리중·실패…)는 **큐에 들어온 행만** 센다 — 아직 안 보낸 건은 구조적으로 0이다.
   *    그래서 알림이 "미발송 5건"이라고 말하는데 카드는 "0 대기 0 처리중"이라 원장이 *"알림이 틀린거야?"*라고
   *    물었다(2026-09-09 — 알림이 옳았다). 이 숫자가 그 간극을 메운다.
   * ⚠️ 게이트는 발송 콘솔·알림과 **같은 한 벌**([`unsent-sendable.ts`](src/features/report-admin/unsent-sendable.ts)) —
   *    보낼 수 없는 건(기한 밖·과목 미허용·미발송 반·멘트 없음·그날 결석)은 세지 않는다.
   */
  /** ⚠️ 조회·게이트가 실패하면 **null**이다(0이 아니다) — 화면은 그때 줄을 감춘다("미발송 0건"이라는 거짓 안심 금지). */
  unsentSendable: number | null;
  /** 그중 가장 오래된 보고서 날짜(YYYY-MM-DD) — 기한이 임박한 쪽을 먼저 보게. 없으면 null. */
  unsentOldestDate: string | null;
};

// 워커 하트비트가 이 분(minutes) 이상 끊기면 오프라인(watch 데몬 15초 폴 → 넉넉히 3분).
const WORKER_OFFLINE_MINUTES = 3;

/** 재발송 기한이 지난 실패를 목록에 더 남겨 두는 날수 — '기한 만료'라는 결말을 보고 나서 사라지게. */
const EXPIRED_GRACE_DAYS = 3;

/**
 * **아직 안 보낸 보고서**(발송 이력 없음) 중 지금 보낼 수 있는 것 — 발송 큐 카드의 '미발송' 수.
 *
 * 🔴 큐 조회(`.not("classnote_status","is",null)`)는 이 행들을 한 건도 못 본다 — 카드가 "0 대기"라고
 *    말하는 동안 저장만 된 보고서가 기한을 넘겨 사라진다(원장 제보 2026-09-09).
 * ⚠️ 창은 **발송 기한(오늘 포함 7일)** 그대로다 — 그 밖은 어떤 경로로도 못 나가므로 재촉해도 소용없다.
 * ⚠️ 조회·게이트가 실패하면 **0이 아니라 null**을 돌려준다(화면은 그때 이 줄을 감춘다) — 실패를
 *    "미발송 없음"으로 읽으면 거짓 안심이다.
 */
async function loadSendableUnsent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  today: string,
  classnoteSubjects: readonly string[],
): Promise<{ count: number; oldestDate: string | null } | null> {
  try {
    const minDate = classnoteMinDate(today);
    // 전건 페이지네이션(B2) — 세는 쿼리를 무페이징 select로 만들면 1000행에서 조용히 잘린다.
    // order에 id를 함께 넣어 OFFSET 페이지가 흔들리지 않게 한다.
    const raw = await fetchAllPaged<{
      id: string;
      student_id: string;
      subject: string | null;
      report_date: string;
      class_id: string | null;
      makeup: boolean | null;
      notes: string | null;
    }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("id, student_id, subject, report_date, class_id, makeup, notes")
        .is("classnote_status", null)
        .is("revoked_at", null)
        .or("source.is.null,source.neq.edutrix_import")
        .gte("report_date", minDate)
        .order("report_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (raw.length === 0) return { count: 0, oldestDate: null };

    const rows: UnsentRow[] = raw.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      reportDate: String(r.report_date).slice(0, 10),
      subject: r.subject,
      classId: r.class_id,
      makeup: r.makeup,
      ment: r.notes,
    }));
    const [optoutClassIds, absenceBlockedKeys] = await Promise.all([
      fetchReportOptoutClassIds(supabase, tenantId),
      // 보강은 결석 게이트 밖이라 후보에서 뺀다(발송 콘솔과 같은 규약).
      getAbsenceBlockedKeys(
        supabase,
        tenantId,
        rows
          .filter((r) => !r.makeup)
          .map((r) => ({ studentId: r.studentId, reportDate: r.reportDate, subject: r.subject, classId: r.classId })),
      ),
    ]);
    const sendable = filterUnsentSendable(rows, {
      today,
      classnoteSubjects,
      optoutClassIds,
      absenceBlockedKeys,
      absenceKeyOf: (r) =>
        absenceKeyOf({ studentId: r.studentId, reportDate: r.reportDate, subject: r.subject, classId: r.classId }),
    });
    return {
      count: sendable.length,
      oldestDate: sendable.length > 0 ? sendable[0]!.reportDate : null,
    };
  } catch {
    return null;
  }
}

/**
 * ClassNote 발송 큐 현황(원장 보고서 관리 Part A) — 최근 N일 발송요청 보고서의 상태 집계 + 주의목록 + 워커 상태.
 * RLS로 테넌트 스코프. 로그인만 확인(읽기). edutrix getClassNoteQueueOverview 이식.
 */
export async function getClassnoteQueue(days = 3): Promise<ClassnoteQueueView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!classnoteModuleOn(await getTenantSettings())) return null;
  const supabase = await createClient();
  const today = kstToday();
  const since = daysBefore(today, days);
  const nowMs = Date.now();

  const COLS =
    "id, student_id, subject, report_date, classnote_status, classnote_error, classnote_processing_at, share_token";
  // 발송 기한(오늘 포함 7일) 시작일 — **아직 손 쓸 수 있는가**의 경계. 3일 창보다 넓다.
  const minDate = classnoteMinDate(today);
  // 창 안 전체 + **창 무관 '사람이 풀어야 하는' 잔여분**(blocked_shared·name_conflict)을 함께 본다.
  // 후자는 원장이 조치할 때까지 며칠이고 남는데, 창에 걸려 사라지면 재발송 UI(이 카드가 유일)도 같이 사라져
  // 해소 불가능한 막다른 길이 된다(HUMAN_RESOLVED_STATUSES 주석 참조). 독립 조회라 병렬(B4).
  const [{ data: rowsRaw }, { data: stuckRaw }, { data: failedRaw }, { count: expiredUnsentCount }] =
    await Promise.all([
    supabase
      .from("lesson_reports")
      .select(COLS)
      .gte("report_date", since)
      .not("classnote_status", "is", null)
      .order("report_date", { ascending: false })
      .limit(1000),
    supabase
      .from("lesson_reports")
      .select(COLS)
      .in("classnote_status", [...HUMAN_RESOLVED_STATUSES])
      .order("report_date", { ascending: false })
      .limit(200), // 사람 조치 대기분이 200을 넘을 일은 없다(넘으면 운영이 이미 무너진 것)
    // 🔴 실패(failed)도 **아직 기한 안이면 3일 창과 무관하게** 싣는다(2026-08-11 원장 제보로 추가).
    //    이유는 위 blocked_shared·name_conflict와 정확히 같다: 실측된 실패는 전부 "보드에 연결된 원아가
    //    없습니다"류로 **워커가 몇 번을 재시도해도 안 풀리고 사람이 ClassNote에서 배정해야** 끝난다.
    //    그런데 3일 창이 지나면 카드에서 사라지고 재발송 버튼도 함께 사라져(재발송 UI는 이 카드가 유일)
    //    "어제는 있었는데 오늘 없다"가 된다 — 실측 2026-08-11: 실패 16건 중 **15건이 창 밖**이었고
    //    11건은 그 사이 기한까지 넘겨 학부모에게 영영 못 나갔다.
    //    ⚠️ 기한이 지난 뒤에도 **{EXPIRED_GRACE_DAYS}일은 더 남긴다**(적대 검토로 추가): 기한 당일까지
    //    "오늘까지"로 보이던 행이 다음 날 흔적 없이 사라지면 원장이 겪는 일은 처음 문제와 똑같다
    //    ("어제는 있었는데 오늘 없다"). 며칠 남겨 **'기한 만료'라는 결말을 보여 준 뒤** 내린다.
    //    영구히 두지 않는 이유는 되살릴 수단이 없어 그때부턴 순수한 잡음이기 때문 — 총량은 아래 카운트가 맡는다.
    supabase
      .from("lesson_reports")
      .select(COLS)
      .eq("classnote_status", "failed")
      .gte("report_date", daysBefore(minDate, EXPIRED_GRACE_DAYS))
      .order("report_date", { ascending: false })
      .limit(200),
    // 기한까지 넘겨 **영영 못 나간** 건 — 최근 30일. **행을 받지 않는다**(count exact + head, B2).
    // ⚠️ `too_old`도 함께 센다 — 재시도하다 창 밖으로 나가면 상태가 too_old로 갈아끼워지므로,
    //    failed만 세면 "잃은 건"의 일부가 조용히 빠진다(같은 사건의 다른 이름일 뿐).
    supabase
      .from("lesson_reports")
      .select("*", { count: "exact", head: true })
      .in("classnote_status", ["failed", "too_old"])
      .lt("report_date", minDate)
      .gte("report_date", daysBefore(today, 30)),
  ]);
  // 창 안/밖이 겹치므로 id로 중복 제거 — 안 그러면 집계가 두 번 세어진다.
  const byId = new Map<string, (typeof rowsRaw extends null ? never : NonNullable<typeof rowsRaw>)[number]>();
  for (const r of [...(rowsRaw ?? []), ...(stuckRaw ?? []), ...(failedRaw ?? [])]) byId.set(r.id as string, r);
  // ⚠️ 세 조회를 합치면 **삽입 순서**(창 안 → 사람조치 → 실패)가 남아 날짜가 뒤죽박죽 섞인다
  //    — 각 조회는 정렬돼 있어도 합집합은 아니다. 목록이 최신순이 아니면 원장이 "어느 게 급한 건지"를
  //    날짜로 훑을 수 없으므로 여기서 한 번 더 최신순으로 세운다(집계는 순서 무관).
  const rows = [...byId.values()].sort((a, b) =>
    String(b.report_date ?? "").localeCompare(String(a.report_date ?? "")),
  );

  const summary = summarizeQueue(
    rows.map((r) => ({ status: r.classnote_status as string | null, processingAt: r.classnote_processing_at as string | null })),
    nowMs,
  );

  // 주의 필요 목록(관리 액션 대상) — 상한 100.
  const attention = rows
    .filter((r) => needsAttention(r.classnote_status as string | null, r.classnote_processing_at as string | null, nowMs))
    .slice(0, 100);
  // 진행 중(대기·처리중, 주의 대상 아닌 정상 흐름) — 원장이 발송 진행을 눈으로 확인. 상한 100.
  const pendingRows = rows
    .filter((r) => {
      const s = r.classnote_status as string | null;
      return (
        (s === "queued" || s === "processing") &&
        !needsAttention(s, r.classnote_processing_at as string | null, nowMs)
      );
    })
    .slice(0, 100);
  const ids = [...new Set([...attention, ...pendingRows].map((r) => r.student_id as string))];
  const nameRows = await fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const toItem = (r: (typeof rows)[number]): QueueItem => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    reportDate: r.report_date as string,
    status: r.classnote_status as string | null,
    error: r.classnote_error as string | null,
    processingAt: r.classnote_processing_at as string | null,
    shareToken: r.share_token as string | null,
  });
  const items: QueueItem[] = attention.map(toItem);
  const pending: QueueItem[] = pendingRows.map(toItem);

  const { data: wk } = await supabase.from("classnote_workers").select("hostname, last_seen, last_results");
  const workers: WorkerStatus[] = (wk ?? []).map((w) => {
    const mins = Math.floor((nowMs - Date.parse(w.last_seen as string)) / 60_000);
    return {
      hostname: w.hostname as string,
      lastSeenMinutes: Math.max(0, mins),
      online: mins < WORKER_OFFLINE_MINUTES,
      results: formatWorkerResults(w.last_results),
      env: extractWorkerEnv(w.last_results),
      nativePublish: workerSupportsNativePublish(w.last_results),
    };
  });

  const settings = await getTenantSettings();
  // 🔴 위 조회 넷은 전부 **발송 이력이 있는** 행이라, 저장만 하고 안 보낸 건은 한 건도 안 잡힌다.
  //    카드가 "0 대기"인데 알림은 "미발송 5건"이던 간극이 여기서 메워진다(원장 제보 2026-09-09).
  const unsent = await loadSendableUnsent(supabase, user.tenantId, today, settings.report.classnoteSubjects);
  return {
    summary,
    items,
    pending,
    workers,
    nowMs,
    since,
    days,
    sendEnabled: classnoteSendOn(settings),
    expiredUnsent: expiredUnsentCount ?? 0,
    todayKst: today,
    unsentSendable: unsent ? unsent.count : null,
    unsentOldestDate: unsent?.oldestDate ?? null,
  };
}

// 강사 행 + 과목 태그(반 담당·슬롯 라벨 기준) — 카드의 [전체/과목] 분류 칩 소스.
/**
 * `source` — 이 행의 작성률이 **어디서 왔는가**.
 *  `aywa`      = lesson_reports(수학). 일자별·오늘까지 정밀 집계.
 *  `classnote` = ClassNote 반 알림장(영어). 반 단위라 **주간만** 집계하고 일자·오늘은 없다.
 * ⚠️ 화면이 이걸 안 보면 영어 행의 빈 '오늘' 칸을 "수업 없음"으로 렌더해 **거짓말**이 된다
 *    (수업은 있고 일간 집계만 없는 것).
 */
export type TeacherRateRow = TeacherRate & { subjects: string[]; source: "aywa" | "classnote" };
export type WritingRatesView = {
  dates: string[];
  rates: TeacherRateRow[];
  /** 이 뷰가 담은 범위 — 화면이 "주간/월간" 라벨과 월 이동을 결정한다. */
  range: { kind: "week" | "month"; month: string };
};

/** 월 키("2026-07") → 그 달 1일~말일 날짜 배열(오름차순). */
function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * 강사별 주간 작성률(원장 보고서 관리 Part B) — 이번 주(월~일) 작성 건수(강사×일별) + 오늘 대상 대비 작성률·미작성.
 * 오늘 대상 = 오늘 시작된 반(getTodaySchedule status≠upcoming)의 활성 수강생 − 결석. 작성 = 오늘 lesson_report 존재.
 * RLS 테넌트 스코프. edutrix WeeklyTeacherSummary 이식(session snapshot 대신 스케줄+출결로 대상 산출).
 */
/**
 * 영어 강사별 작성률 — **소스가 다르다.** 영어 강사는 aywa가 아니라 ClassNote에 직접 알림장을 쓰므로
 * `lesson_reports`엔 0건으로 잡힌다(빼는 게 아니라 다른 소스로 세야 하는 문제, 2026-07-23 원장 확인).
 * 워커가 적재한 `classnote_class_posts`(0140a)를 반 시간표와 맞춰 센다.
 *
 * 수학 표와 한 표에 섞이므로 `TeacherRateRow` 모양을 맞춘다. 다만 **일자별 셀(daily)·오늘 열은 비운다** —
 * 반 단위 알림장이라 "학생 몇 명 작성"이라는 단위가 없다. 주간 합계(weekWritten/weekTarget)만 채우고
 * 오늘 열은 null로 둬 화면이 "—"로 렌더한다(0으로 채우면 '오늘 안 씀'이라는 거짓말이 된다).
 *
 * ⚠️ 분모 = **현재 시간표 요일** − 공휴일(원장 확인). 실제 수업일과 어긋난 반이 있어 정확도 한계가 있다.
 */
/*
 * ⚠️ **임시 위임(0173a)은 이 영어 경로에 적용하지 않는다 — 빠뜨린 게 아니라 필요가 없다.**
 * 여기 분자는 **반 단위 ClassNote 게시**(classnote_class_posts)라, 대신 들어간 강사가 올려도 그 반의
 * 게시로 잡혀 담임의 분자가 채워진다 → 위임한 날 담임이 **0%로 빨갛게 남는 문제가 애초에 없다**
 * (그 문제는 분자가 작성자 이름인 lesson_reports 경로에만 있다). 대체 강사에게 별도 크레딧이 안 가는 건
 * 남지만, 그걸 주려면 "그 게시를 누가 올렸나"가 필요한데 피드에 그 정보가 없다.
 * → 여기에 위임 귀속을 넣으면 **담임의 분모만 옮겨가고 분자는 그대로 남아** 멀쩡하던 담임이 갑자기 0%가 된다.
 */
async function getEnglishTeacherRates(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
  until: string,
  dates: readonly string[],
): Promise<TeacherRateRow[]> {
  // ClassNote 기능이 꺼진 학원 = 영어 알림장 소스가 없다 → 이 경로 자체를 세우지 않는다(2026-09-30 "꺼지면 흔적 없이").
  if (!classnoteModuleOn(await getTenantSettings())) return [];
  const { data: classRows } = await supabase
    .from("classes")
    .select("id, class_name, teacher:teacher_id ( display_name ), class_schedules ( day_of_week, valid_from, valid_to )")
    .eq("subject", "english")
    .eq("is_active", true)
    // 영어 반은 위 lesson_reports 경로 분모에 애초에 없다 — '미발송' 제외는 **여기서만** 걸린다(0174a).
    .eq("report_optout", false);
  if (!classRows?.length) return [];

  const today = kstToday();
  const classes: EnglishClassInput[] = classRows.map((c) => {
    const t = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as { display_name?: string } | null;
    const sched = (c.class_schedules ?? []) as { day_of_week: string; valid_from: string | null; valid_to: string | null }[];
    // 현재 유효한 슬롯의 요일만 — 지난 개편(컷오버)으로 마감된 슬롯이 분모를 부풀리면 안 된다.
    const dows = [
      ...new Set(
        sched
          .filter((s) => (!s.valid_to || s.valid_to >= today) && (!s.valid_from || s.valid_from <= today))
          .map((s) => s.day_of_week as Dow),
      ),
    ];
    return { classId: c.id as string, className: c.class_name as string, teacher: t?.display_name ?? null, dows };
  });

  // 보드×날짜 행은 수학 반 보드 게시분까지 함께 쌓여 한 달이면 1,000행에 다가간다 — 무페이징이면
  // 조용히 잘려 작성일이 사라진다(B2). 재원 판정(그날 학생이 있는 반만 분모)은 운영실과 같은 함수.
  // 재원 판정은 분모를 거르는 보조 재료라 실패하면 거르지 않고 넘어간다(작성률 면 전체를 죽이지 않는다 —
  // fetchDelegateAttribution과 같은 결). 게시 기록은 분자 자체라 실패를 삼키지 않는다(거짓 0%보다 오류가 낫다).
  const [posts, enrollmentRows, settings] = await Promise.all([
    fetchAllPaged<{ board_name: string; posted_on: string }>((from, to) =>
      supabase
        .from("classnote_class_posts")
        .select("board_name, posted_on")
        .gte("posted_on", since)
        .lte("posted_on", until)
        .order("board_name")
        .order("posted_on")
        .range(from, to),
    ),
    fetchAllPagedInChunks<ClassEnrollmentRow>(
      classes.map((c) => c.classId),
      (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select("id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days, student:students!inner(is_test)")
          .eq("student.is_test", false)
          .in("class_id", chunk)
          .or(`start_date.is.null,start_date.lte.${until}`)
          .or(`end_date.is.null,end_date.gte.${since}`)
          .order("id")
          .range(from, to),
    ).catch((e: unknown) => {
      logDbError(e, "report-admin/english-rates/enrollments");
      return null;
    }),
    getTenantSettings(),
  ]);

  // 아직 오지 않은 날은 분모가 아니다(수학 경로도 미래일을 뺀다). 영어는 일간 칸이 없어 '오늘 이미 시작한
  // 수업'을 가를 수 없고 게시는 수업 뒤에 올라오므로(워커 30분 주기) **어제까지**만 센다(2026-10-13 —
  // 이번 주 보기면 남은 요일, 이번 달 보기면 남은 날 전부가 '안 씀'으로 섞여 있었다).
  const lastCounted = until < today ? until : daysBefore(today, 1);
  const rows = computeEnglishRates(
    classes,
    posts.map((p) => ({ boardName: p.board_name, postedOn: String(p.posted_on).slice(0, 10) })),
    {
      from: since,
      to: lastCounted,
      holidays: settings.operations.holidays.map((h) => h.date),
      hasStudentsOn: enrollmentRows ? buildHasStudentsOn(enrollmentRows) : undefined,
    },
  );

  return foldByTeacher(rows).map((t) => ({
    teacher: t.teacher,
    // 일자별 셀은 target=null로 둔다 → 화면이 "·"(수업 없음/집계 불가)로 렌더한다.
    // 반 단위 알림장이라 "그날 학생 몇 명분 작성"이라는 단위 자체가 없다. 0으로 채우면 거짓말.
    daily: dates.map((date) => ({ date, count: 0, target: null, written: 0, rate: null })),
    weekWritten: t.written,
    weekTarget: t.sessions,
    weekRate: t.rate,
    todayTarget: 0,
    todayWritten: 0,
    todayMissing: [],
    todayRate: null,
    todayPending: null,
    subjects: ["english"],
    source: "classnote" as const,
  }));
}

/**
 * 이 기간에 걸친 임시 위임(0173a) → (반, 날짜) 귀속 함수. 위임이 없으면(대부분의 주) 왕복 1회로 끝난다.
 * 축이 **이름 문자열**이라(작성 기록이 이름으로만 남는다) 표시명이 없는 대체 강사는 귀속 대상에서 뺀다 —
 * 그러면 종전대로 담임에게 남는다(fail-safe: 미작성이 조용히 사라지는 방향이 아니다).
 * 조회 실패는 빈 귀속(= 위임 없던 것처럼) — 작성률 화면 전체를 죽이지 않는다.
 */
async function fetchDelegateAttribution(
  supabase: Awaited<ReturnType<typeof createClient>>,
  since: string,
  until: string,
): Promise<DelegateAttribution> {
  const { data } = await supabase
    .from("class_delegations")
    .select("class_id, delegate_user_id, from_date, to_date")
    .is("revoked_at", null)
    .lte("from_date", until)
    .gte("to_date", since)
    .limit(500);
  const rows = (data ?? []) as {
    class_id: string;
    delegate_user_id: string;
    from_date: string;
    to_date: string;
  }[];
  if (rows.length === 0) return buildDelegateAttribution([]);
  const ids = [...new Set(rows.map((r) => r.delegate_user_id))];
  const users = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  const nameById = new Map(users.map((u) => [u.id, (u.display_name ?? "").trim()]));
  return buildDelegateAttribution(
    rows.map((r) => ({
      classId: r.class_id,
      teacherName: nameById.get(r.delegate_user_id) ?? "",
      fromDate: r.from_date,
      toDate: r.to_date,
    })),
  );
}

export async function getWeeklyWritingRates(month?: string): Promise<WritingRatesView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = kstToday();
  // 범위 = 이번 주(기본) 또는 지정한 달. **날짜 배열만 달라지고 아래 로직은 그대로**다 —
  // 대상(분모) 산출이 이미 날짜 단위(분리등원·휴원·그날 결석)라 7일이든 31일이든 같은 코드가 돈다.
  // ⚠️ 비용도 거의 안 늘어난다: class_schedules는 **요일 단위**(7행)라 달이어도 그대로고, 작성기록은
  //    fetchAllPaged(전건), 반 집합도 동일하다. 늘어나는 건 JS 날짜 루프뿐.
  const isMonth = !!month && /^\d{4}-\d{2}$/.test(month);
  const dowIdx = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토
  const monday = daysBefore(today, (dowIdx + 6) % 7); // 이번 주 월요일(월=0 기준 오프셋)
  const dates = isMonth
    ? monthDates(month!)
    : Array.from({ length: 7 }, (_, i) => daysBefore(monday, -i)); // 월→일 오름차순
  if (dates.length === 0) return null;
  const since = dates[0]!;
  const until = dates[dates.length - 1]!;
  const range = { kind: (isMonth ? "month" : "week") as "week" | "month", month: (month ?? today).slice(0, 7) };
  // 오늘이 범위 밖(지난 달·다음 달)이면 '오늘' 열이 의미 없다 — 무거운 오늘 스케줄 조회를 건너뛴다.
  const includesToday = today >= since && today <= until;

  // 1) 이번 주 작성 기록·오늘 스케줄·설정(예외 강사)·강사→과목 라벨·퇴사(비활성) 직원 — 상호 독립이라 병렬(B4).
  // ⚠️ 작성 기록은 강사×일 집계 소스라 절단되면 작성률이 과소집계된다. `.limit(5000)`은 방어가 안 됨 —
  // PostgREST max-rows(≈1000)가 명시 limit도 덮어 1000행에서 silent 절단(실측 확인, #54). fetchAllPaged로 전건.
  // 테스트 학생(0141a `students.is_test`) — ClassNote 발송 시험용(`학원이`). 이 학생 앞으로 생긴
  // 보고서가 집계에 섞이면 ① 계정도 없는 가짜 작성자(`테스트`·`테스트강사`)가 강사로 등장하고
  // ② 실강사 분자가 부풀려진다(김민주 8건·이수진 1건 실측). **분자에서 원천 제외**한다.
  // ⚠️ 화면에서 숨기는 게 아니다 — 학생목록·발송에는 그대로 보여야 원장이 테스트할 수 있다.
  const { data: testStudents } = await supabase.from("students").select("id").eq("is_test", true);
  const testStudentIds = new Set((testStudents ?? []).map((s) => s.id as string));

  const [reps, schedule, weekly, settings, labelsBySubject, { data: inactiveStaff }, delegateOn, reportOptoutIds] =
    await Promise.all([
    // ⚠️ 집계 기준은 **유효일 = covers_date ?? report_date**(0136a) — 미리/나중에 쓴 보고서를 실제 수업일로 귀속.
    //   그래서 범위 조회도 두 날짜 **중 하나라도** 걸치면 가져온 뒤(or) JS에서 유효일로 다시 거른다.
    //   report_date만으로 자르면 "6/28에 쓰고 7/2 수업분"인 보고서가 7월 뷰에서 통째로 사라진다.
    fetchAllPaged<{
      teacher_name: string | null;
      report_date: string;
      covers_date: string | null;
      student_id: string;
      class_id: string | null;
    }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("teacher_name, report_date, covers_date, student_id, class_id")
        .or(
          `and(report_date.gte.${since},report_date.lte.${until}),and(covers_date.gte.${since},covers_date.lte.${until})`,
        )
        // OFFSET 페이지 안정화 — unique tie-break(id) 포함 order(batch.ts 계약)
        .order("report_date")
        .order("id")
        .range(from, to),
    ),
    // 오늘이 범위 밖이면 '오늘' 정밀 계산이 무의미하다 — 조회 자체를 건너뛴다(지난 달 열람 비용 절감).
    includesToday ? getTodaySchedule() : Promise.resolve([]),
    getWeeklySchedule(), // 요일별 대상(분모) 계산용 — 요일 단위라 주/월 무관하게 같은 비용
    getTenantSettings(),
    getTeacherLabelsBySubject(),
    // 퇴사자 = users.status 'inactive'(RLS 테넌트 스코프, 직원 표라 소량). 이름으로 작성률에서 자동 제외.
    supabase.from("users").select("display_name").eq("status", "inactive"),
    // 임시 위임(0173a) — 위임된 (반, 날짜)의 **대상(분모)을 대체 강사로 옮긴다**(writing-rate-delegation.ts).
    fetchDelegateAttribution(supabase, since, until),
    // '수업보고서 미발송' 반(0174a) — 대상(분모)에서 통째로 뺀다(원장: "괜히 작성률도 0%로 오해받지않고").
    fetchReportOptoutClassIds(supabase),
  ]);
  // 작성 예외 강사 = 학원설정 report.writingExemptTeachers(수동 지정) + 퇴사(비활성) 처리된 직원(자동).
  // 퇴사자는 수동 등록 없이도 주간 기록·오늘 대상 모두에서 빠진다 — 재직 중 미작성만 미작성으로 집계.
  const exempt = new Set(settings.report.writingExemptTeachers);
  for (const u of inactiveStaff ?? []) {
    const name = (u.display_name as string | null)?.trim();
    if (name) exempt.add(name);
  }
  /**
   * ClassNote로 재는 과목은 이 경로(lesson_reports)에서 **분모에 넣지 않는다.**
   *
   * 영어 강사는 aywa가 아니라 ClassNote에 직접 쓰므로 lesson_reports가 늘 0건이다. 그대로 두면
   * ① `김태건 0% (0/201)`처럼 **거짓 0%**가 뜨고 ② 아래 getEnglishTeacherRates가 만든 진짜 행과
   * **같은 강사가 두 줄**로 나온다(2026-07-23 원장 제보 — 실제로 그렇게 보였다).
   * 두 경로를 과목으로 갈라 겹치지 않게 한다: 여기 = 영어 외, 저기 = 영어.
   */
  const CLASSNOTE_MEASURED = new Set(["english"]);
  // 🔴 세는 과목은 운영실 '미작성 보고서'와 같은 축 = 학원설정 report.classnoteSubjects(비면 전부) — 예전엔 여기만
  //    '영어 뺀 전부'(코드 고정)라 설정에 없는 과목이 작성률에만 섰다(점검 2026-09-28).
  const trackedSubjects = settings.report.classnoteSubjects ?? null;
  const measuredHere = (subject: string | null | undefined) =>
    !CLASSNOTE_MEASURED.has(String(subject ?? "")) && isReportTrackedSubject(subject ?? null, trackedSubjects);
  /**
   * 이 슬롯을 **분모에 넣는가** — 과목 갈래(measuredHere) + 반 단위 제외(0174a).
   * 🔴 아래 세 곳(오늘 분모·오늘 수업예정·과거일 분모)에서 **전부** 써야 한다. 하나라도 빠지면
   *    "표에선 사라졌는데 '18:20 수업 예정'만 남는" 유령 행이 생긴다(2026-07-23 영어 두 줄과 동형).
   */
  const countedHere = (s: { subject?: string | null; classId: string }) =>
    measuredHere(s.subject) && !reportOptoutIds.has(s.classId);
  // 보고서는 **쓴 날(report_date)에 그대로** 집계한다. covers_date는 집계를 옮기는 게 아니라
  // "그 날 수업의 의무를 이 보고서가 대신했다"는 표시라, 아래에서 **분모(대상)에서 빼는** 데 쓴다(0136a).
  // ⚠️ 옮기면 연속수업(7/3에 2타임 몰아서 하고 보고서 1건)에서 7/3이 거꾸로 미작성이 된다.
  /**
   * 🔴 **분자도 분모와 같은 반 집합을 봐야 한다**(0174a 적대검수에서 확정).
   *
   * 분모(countedHere)에서만 미발송 반을 빼면, 그 반에서 쓴 보고서가 **다른 반의 미작성을 메운다** —
   * 과거일 근사가 `written = min(작성건수, 대상)`이라 초과분이 캡에 흡수되기 때문이다.
   * 실패 방향이 최악이다: 진짜 미작성이 **100%로 가려진다**(원장 요구와 정반대). 재현 — 랩실 반에 4건
   * 쓰고 정규 반 3명을 안 쓴 강사가 3/3 = 100%(토글 전엔 4/7 = 57%).
   * ⚠️ `class_id`가 NULL인 건(이관분·보강)은 반을 특정할 수 없어 **그대로 둔다** — events.ts와 같은
   *    규약("모르면 빼지 않는다"). 새로 쓰이는 보고서는 원스크린이 class_id를 채운다.
   * ⚠️ 면제(discharged)도 같은 소스로 만든다 — 안 그러면 미발송 반 보고서의 covers_date가 **집계 대상
   *    반의 의무를 잘못 면제**해 같은 방향(분모를 깎는 쪽)으로 거짓말한다.
   */
  const repsCounted = (reps ?? []).filter((r) => !r.class_id || !reportOptoutIds.has(r.class_id));
  const reports = repsCounted
    .map((r) => ({
      teacher: (r.teacher_name as string | null) ?? "(미지정)",
      date: r.report_date as string,
      studentId: r.student_id as string,
    }))
    // or() 조회로 범위 밖 행(covers_date만 걸친 것)이 섞여 온다 — 쓴 날 기준으로 다시 좁힌다.
    .filter((r) => r.date >= since && r.date <= until)
    .filter((r) => !exempt.has(r.teacher))
    .filter((r) => !testStudentIds.has(r.studentId)); // 테스트 학생분 제외(0141a)

  /**
   * **의무가 면제된 (학생, 날짜)** — 보고서에 실제 수업일(covers_date)이 지정된 건(0136a).
   * 그 날은 그 학생이 오지 않는다(미리 했거나 앞 수업에 몰아서 했다) → 대상에서 뺀다.
   * 두 케이스 모두 이 한 규칙으로 풀린다:
   *   · 선발송  = 7/19분을 7/3에 미리 함 → 7/19 대상에서 제외
   *   · 연속수업 = 7/19분을 7/3에 2타임으로 함(보고서 1건) → 7/19 대상에서 제외(7/3은 보고서가 있어 그대로 충족)
   */
  // ⚠️ 키에 **강사**를 넣는다 — 학생·날짜만으로 잡으면 수학 보고서의 지정이 같은 날 **영어 강사 분모에서도**
  //    그 학생을 빼버려(이 학원은 다중강사 학생이 흔하다) 남의 미작성을 조용히 가린다(적대 검증 확정).
  //    라벨이 안 맞으면 면제가 '적용 안 되는' 쪽으로 실패한다 — 강사는 빨갛게 남아 눈에 띄므로
  //    "부당하게 빠지는" 방향보다 안전하다(fail-safe).
  const dischargeKey = (studentId: string, date: string, teacher: string) => `${studentId}|${date}|${teacher}`;
  const discharged = new Set(
    repsCounted
      .filter((r) => r.covers_date)
      .map((r) =>
        dischargeKey(r.student_id, r.covers_date as string, (r.teacher_name as string | null) ?? "(미지정)"),
      ),
  );

  // 2) 오늘 시작된 반 → 강사별 classIds (예외 강사 반 제외).
  // 귀속 = 반 담당(teacherName) 우선, 없으면 **슬롯 강사 라벨 폴백** — 반 담당 없이 슬롯 라벨로만 도는
  // 영어반(RTT2류)이 "(미지정)"으로 뭉치지 않게. 라벨 인물이 예외면 그 슬롯도 예외로 빠진다.
  const started = schedule.filter((s) => s.status !== "upcoming" && countedHere(s));
  const teacherOfClass = new Map<string, string>();
  const subjectOfClass = new Map<string, string>();
  for (const s of started) {
    // 위임된 날은 **대신 맡은 사람**이 그 반의 주인이다(0173a) — 그래야 결근한 담임이 0%로 빨갛게 남지 않고,
    // 대신 쓴 강사의 작성이 대상 없이 "·"로 사라지지 않는다.
    const t = delegateOn(s.classId, today) ?? s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
    if (exempt.has(t)) continue;
    teacherOfClass.set(s.classId, t);
    if (s.subject) subjectOfClass.set(s.classId, s.subject);
  }
  const classIds = [...teacherOfClass.keys()];

  // 2-b) 오늘 **아직 시작 안 한** 수업 — 분모엔 안 넣지만(시작 전을 미작성으로 몰면 안 됨) "수업 없음"과
  // 구분해야 한다. 옛 화면은 둘 다 "수업 없음"이라 저녁 수업만 있는 강사가 낮엔 수업이 없는 것처럼 보였다.
  const pendingByTeacher = new Map<string, { classes: number; firstStart: string }>();
  for (const s of schedule) {
    if (s.status !== "upcoming") continue;
    // ⚠️ 여기도 과목으로 갈라야 한다 — 이 한 줄이 빠져서 영어 강사가 **두 줄**로 나왔다(2026-07-23 원장 제보).
    // 분모(started)·주간(weekly)은 걸렀는데 '수업 예정'만 안 걸러, 오늘 수업이 남은 영어 강사가
    // `김태건 14:20 수업 예정 (주간 ·)`이라는 **빈 aywa 행**을 하나 더 만들었다(rates는 강사 이름 집합으로
    // 행을 만들므로, pending만 있어도 행이 생긴다). 영어의 진실은 아래 ClassNote 행 하나뿐이다.
    if (!countedHere(s)) continue;
    // '수업 예정'도 위임을 따른다 — 분모(started)만 옮기고 여기를 빼먹으면 결근한 담임에게 "수업 예정"이 남는다.
    const t = delegateOn(s.classId, today) ?? s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
    if (exempt.has(t)) continue;
    const cur = pendingByTeacher.get(t);
    const start = s.startTime.slice(0, 5); // "20:10:00" → "20:10"
    if (!cur) pendingByTeacher.set(t, { classes: 1, firstStart: start });
    else pendingByTeacher.set(t, { classes: cur.classes + 1, firstStart: start < cur.firstStart ? start : cur.firstStart });
  }
  const todayPendings: TodayPending[] = [...pendingByTeacher].map(([teacher, v]) => ({ teacher, ...v }));

  let todayTargets: TodayTarget[] = [];
  if (classIds.length > 0) {
    // 3) 오늘 시작 반의 **오늘 오는** 수강생(기간·휴원·분리등원 반영).
    const enr = (
      await fetchAllPagedInChunks<TargetEnrollment>(classIds, (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select(TARGET_ENROLLMENT_COLS)
          .in("class_id", chunk)
          .lte("start_date", today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          // OFFSET 페이지 안정화 — unique tie-break 포함 order(batch.ts 계약)
          .order("id", { ascending: true })
          .range(from, to),
      )
    ).filter((e) => attendsOn(e, today));
    const studentsByTeacher = new Map<string, Set<string>>();
    for (const e of enr) {
      const t = teacherOfClass.get(e.class_id);
      if (!t) continue;
      if (testStudentIds.has(e.student_id)) continue; // 테스트 학생은 분모에도 넣지 않는다(0141a)
      if (!studentsByTeacher.has(t)) studentsByTeacher.set(t, new Set());
      studentsByTeacher.get(t)!.add(e.student_id);
    }
    const allStudentIds = [...new Set(enr.map((e) => e.student_id))];

    // 4) 오늘 출결 + 오늘 쓴·오늘을 지정한 보고서 + 이름.
    const [attRows, todayRepRows, nameRows] = await Promise.all([
      fetchInChunks<{
        id: string;
        student_id: string;
        class_id: string;
        session_date: string;
        slot_start: string | null;
        status: string;
        recorded_at: string;
      }>(allStudentIds, (chunk) =>
        supabase
          .from("attendance_records")
          .select("id, student_id, class_id, session_date, slot_start, status, recorded_at")
          .eq("session_date", today)
          .in("student_id", chunk),
      ),
      fetchInChunks<{
        student_id: string;
        subject: string | null;
        report_date: string;
        covers_date: string | null;
        class_id: string | null;
      }>(
        allStudentIds,
        (chunk) =>
          supabase
            .from("lesson_reports")
            .select("student_id, subject, report_date, covers_date, class_id")
            .or(`report_date.eq.${today},covers_date.eq.${today}`)
            .in("student_id", chunk),
      ),
      fetchInChunks<{ id: string; name: string }>(allStudentIds, (chunk) =>
        supabase.from("students").select("id, name").in("id", chunk),
      ),
    ]);
    const nameById = new Map(nameRows.map((s) => [s.id, s.name]));

    // 5) 🔴 오늘 판정은 운영실·브리핑 '미작성 보고서'와 **같은 함수**(`judgeTodayLessonReports`) — 그 과목 반이 전부 결석이면 대상 아님 ·
    //    그 과목 보고서만 작성 인정 · 오늘을 지정한 미리 쓴 보고서는 의무 끝(점검 2026-09-28: 예전엔 '그날 어느 반이든 결석이면 통째 제외'
    //    · '아무 과목 보고서나 인정'이라 두 화면 숫자가 갈렸다). 강사 귀속만 이 카드의 몫이다(위임 → 담임 → 슬롯 라벨).
    const judged = judgeTodayLessonReports(
      enr
        .filter((e) => teacherOfClass.has(e.class_id) && !testStudentIds.has(e.student_id))
        .map((e) => ({ studentId: e.student_id, classId: e.class_id, subject: subjectOfClass.get(e.class_id) ?? "" })),
      absentClassKeysOf(attRows),
      // 미발송 반(0174a) 보고서는 다른 반 의무를 채우거나 면제하지 않는다(위 repsCounted와 같은 규약 · class_id 없으면 둔다).
      todayRepRows.filter((r) => !r.class_id || !reportOptoutIds.has(r.class_id)).map((r) => ({
        studentId: r.student_id,
        subject: r.subject,
        reportDate: String(r.report_date).slice(0, 10),
        coversDate: r.covers_date ? String(r.covers_date).slice(0, 10) : null,
      })),
      today,
    );
    todayTargets = [...studentsByTeacher.keys()].map((teacher) => {
      const mine = (p: { classIds: string[] }) => p.classIds.some((c) => teacherOfClass.get(c) === teacher);
      const due = [...new Set(judged.due.filter(mine).map((p) => p.studentId))];
      const missingIds = [...new Set(judged.missing.filter(mine).map((p) => p.studentId))];
      return {
        teacher,
        target: due.length,
        written: due.length - missingIds.length,
        missing: missingIds.map((id) => nameById.get(id) ?? "(학생)").slice(0, 20),
      };
    });
  }

  // 6) 과거일(월~어제) 강사×날짜 대상 — 오늘 로직(반 활성 수강생 − 그날 결석)을 이번 주 지난 요일로 일반화.
  //    주간 스케줄로 그 요일 반→강사(예외 제외), 활성 수강(end_date null), 그날 결석을 빼 대상 수를 구한다.
  //    오늘은 위 todayTargets(정밀)로 별도, 미래일은 대상 없음(pure 함수가 null 처리). 작성분은 min(건수,대상) 근사.
  const pastDates = dates.filter((d) => d < today);
  const dailyTargets: DailyTarget[] = [];
  if (pastDates.length > 0) {
    // 과거일별 반→강사(예외 제외) + 주간 반 id 집합.
    const teacherOfClassByDate = new Map<string, Map<string, string>>();
    const weekClassIds = new Set<string>();
    for (const d of pastDates) {
      const key = weekdayKeyOf(d);
      const m = new Map<string, string>();
      for (const s of weekly) {
        if (s.dayOfWeek !== key) continue;
        if (!countedHere(s)) continue; // 영어는 ClassNote 경로가 잰다(중복·거짓 0% 방지) + 미발송 반 제외(0174a)
        // 오늘 로직과 동일: **그날 위임** → 반 담당 → 슬롯 라벨 폴백(반 담당 없는 영어반 "(미지정)" 방지).
        // ⚠️ 위임은 날짜마다 다르다 — 여기서 `today`를 쓰면 지난 요일 귀속이 통째로 틀어진다.
        const t = delegateOn(s.classId, d) ?? s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
        if (exempt.has(t)) continue;
        m.set(s.classId, t);
        weekClassIds.add(s.classId);
      }
      teacherOfClassByDate.set(d, m);
    }
    if (weekClassIds.size > 0) {
      // 수강 행(오늘 로직과 동일 판정: 기간·휴원·분리등원) + 주간(월~어제) 결석.
      // ⚠️ 날짜마다 오는 학생이 다르므로(분리등원) 반→학생 집합을 미리 굳히지 않고 **날짜별로** 판정한다.
      const wenr = await fetchAllPagedInChunks<TargetEnrollment>([...weekClassIds], (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select(TARGET_ENROLLMENT_COLS)
          .in("class_id", chunk)
          .lte("start_date", pastDates[pastDates.length - 1]!)
          .or(`end_date.is.null,end_date.gte.${pastDates[0]!}`)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const enrollmentsByClass = new Map<string, TargetEnrollment[]>();
      const weekStudentIds = new Set<string>();
      for (const e of wenr) {
        (enrollmentsByClass.get(e.class_id) ?? enrollmentsByClass.set(e.class_id, []).get(e.class_id)!).push(e);
        weekStudentIds.add(e.student_id);
      }
      const absRows = weekStudentIds.size
        ? await fetchInChunks<{ student_id: string; session_date: string }>([...weekStudentIds], (chunk) =>
            supabase
              .from("attendance_records")
              .select("student_id, session_date")
              .eq("status", "absent")
              .gte("session_date", pastDates[0]!)
              .lte("session_date", pastDates[pastDates.length - 1]!)
              .in("student_id", chunk),
          )
        : [];
      const absentByDate = new Map<string, Set<string>>();
      for (const a of absRows)
        (absentByDate.get(a.session_date) ?? absentByDate.set(a.session_date, new Set()).get(a.session_date)!).add(a.student_id);
      // 강사×날짜 대상 = 그날 강사 반들의 **그날 오는** 학생(중복 제거) − 그날 결석.
      for (const d of pastDates) {
        const absent = absentByDate.get(d) ?? new Set<string>();
        const studentsByTeacher = new Map<string, Set<string>>();
        for (const [classId, teacher] of teacherOfClassByDate.get(d)!) {
          const rows = enrollmentsByClass.get(classId);
          if (!rows) continue;
          const ts = studentsByTeacher.get(teacher) ?? studentsByTeacher.set(teacher, new Set()).get(teacher)!;
          for (const e of rows) if (attendsOn(e, d) && !testStudentIds.has(e.student_id)) ts.add(e.student_id);
        }
        for (const [teacher, ids] of studentsByTeacher) {
          // 오늘과 같은 규칙: 결석 + 의무 면제(covers_date) 제외.
          const target = [...ids].filter(
            (id) => !absent.has(id) && !discharged.has(dischargeKey(id, d, teacher)),
          ).length;
          dailyTargets.push({ teacher, date: d, target });
        }
      }
    }
  }

  // 강사→과목 태그(반 담당·슬롯 라벨 역인덱스) — 미지의 이름은 빈 배열(카드에서 '전체'에만 노출).
  const subjectsOfTeacher = new Map<string, Set<string>>();
  for (const [subj, names] of Object.entries(labelsBySubject))
    for (const n of names)
      (subjectsOfTeacher.get(n) ?? subjectsOfTeacher.set(n, new Set()).get(n)!).add(subj);

  // 학원이 휴일로 지정한 날은 분모에서 뺀다(원장 2026-07-22) — 스케줄상 반이 있어도 수업을 안 했으므로
  // 그날 0%는 거짓 빨강이다. ⚠️ **공휴일 자동 포함은 하지 않는다** — 학원이 설정에 넣은 날짜만 본다
  // (공휴일에도 여는 학원이 있어 임의로 빼면 진짜 미작성을 가린다). 필요하면 학원설정에 추가하면 된다.
  const rates: TeacherRateRow[] = computeWritingRates(
    dates,
    reports,
    todayTargets,
    dailyTargets,
    today,
    todayPendings,
    settings.operations.holidays,
  ).map((r) => ({
    ...r,
    subjects: [...(subjectsOfTeacher.get(r.teacher) ?? [])],
    source: "aywa" as const,
  }));
  // 영어는 강사가 ClassNote에 직접 써서 lesson_reports에 안 남는다 — 워커가 적재한
  // classnote_class_posts(0140a)로 따로 계산해 **같은 표에 합친다**(과목 칩이 그대로 걸러 준다).
  const english = await getEnglishTeacherRates(supabase, since, until, dates);
  return { dates, rates: [...rates, ...english], range };
}

export type ReportFilterOptions = {
  teachers: string[];
  subjects: string[];
  /** 최근 창에 **실제로 보고서가 붙은** 반만(0147a RPC). 반 149개 전체가 아니라 = 0건 옵션 방지. */
  classes: { id: string; name: string }[];
  /** ment_source(0214a) 적용 여부 — false면 멘트 작성 방식 필터·열을 통째로 숨긴다(반 필터 fail-soft와 같은 결). */
  mentSourceReady: boolean;
};

/**
 * 보고서 목록 필터 옵션(원장 보고서 관리 Part C) — 최근 보고서에서 강사·과목 distinct.
 *
 * ⚠️ 전건 select 금지(B2). 옛 구현은 `.select("teacher_name, subject").limit(5000)`으로 전건을 받아
 * JS Set으로 distinct를 만들었는데, PostgREST max-rows(≈1000)가 명시 limit을 덮어 **에러 없이** 잘렸다:
 * 최근 60일 4,010행 중 1,000행만 도달 → distinct 강사 14명 중 3명이 옵션에서 통째로 누락됐고,
 * 소비처가 자유입력 없는 <select>라 그 강사의 보고서는 어떤 경로로도 필터할 수 없었다(2026-07-21).
 * distinct = 집계이므로 group-by RPC(0126a)로 내린다 — 4,010행 스캔 → 17행 반환.
 *
 * 반(class) 옵션은 **별도 RPC(0147a — 운영엔 빠져 있어 s2_0045로 다시 만든다)** 를 병렬로 부른다(B4). 0126a에 컬럼을 더하지 않은 이유는
 * 0147a 마이그레이션 주석 참조(반환 타입 변경 = DROP 필요 + distinct 조합 폭증).
 * ⚠️ 반 옵션은 **fail-soft**다 — 0147a 적용 전에 코드가 먼저 배포돼도 반 드롭다운만 비고
 *    강사·과목 필터와 목록은 그대로 동작한다(배포 순서 제약 제거).
 */
export async function getReportFilterOptions(): Promise<ReportFilterOptions> {
  const user = await getCurrentUser();
  const empty: ReportFilterOptions = { teachers: [], subjects: [], classes: [], mentSourceReady: false };
  if (!user) return empty;
  const supabase = await createClient();
  const since = daysBefore(kstToday(), 60);
  // 서로 독립인 두 RPC + ment_source probe(0214a) → 직렬 워터폴 금지(B4).
  const [main, cls, mentSourceReady] = await Promise.all([
    supabase.rpc("lesson_report_filter_options", { p_since: since }),
    supabase.rpc("lesson_report_class_options", { p_since: since }),
    mentSourceColumnReady(supabase),
  ]);
  // 반 옵션 실패는 본 옵션을 죽이지 않는다(마이그레이션 미적용 = 함수 없음이 정상 시나리오).
  const classes: { id: string; name: string }[] = [];
  if (cls.error) {
    console.error("[report-admin] 반 필터 옵션 조회 실패(s2_0045 미적용?)", cls.error);
  } else {
    for (const r of (cls.data ?? []) as { class_id: string | null; class_name: string | null }[]) {
      if (r.class_id && r.class_name) classes.push({ id: r.class_id, name: r.class_name });
    }
    // ⚠️ 정렬은 **여기서** 확정한다(gotcha #84): DB 콜레이션은 로마자를 한글보다 앞에 두는데 반 이름은
    //    'JP1'·'중등E_중1 TOP'처럼 섞여 있어 화면 다른 목록과 순서가 갈린다. SQL 함수 안의 ORDER BY도
    //    바깥 쿼리에서 보존이 보장되지 않으므로 의존하지 않는다.
    classes.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }
  if (main.error) {
    // 옵션이 비면 필터를 못 쓸 뿐 목록 자체는 보이므로 화면을 죽이지 않는다. 단 조용히 넘기면
    // "필터에 강사가 안 뜬다"가 또 원인 불명이 되므로 로그는 남긴다.
    console.error("[report-admin] 필터 옵션 조회 실패", main.error);
    return { ...empty, classes, mentSourceReady };
  }
  const teachers = new Set<string>();
  const subjects = new Set<string>();
  for (const r of (main.data ?? []) as { teacher_name: string | null; subject: string | null }[]) {
    if (r.teacher_name) teachers.add(r.teacher_name);
    if (r.subject) subjects.add(r.subject);
  }
  return { teachers: [...teachers].sort(), subjects: [...subjects].sort(), classes, mentSourceReady };
}
