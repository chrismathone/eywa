import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, monthOf, monthRange, shiftMonth } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent, MERGE_NOTE_PREFIX } from "@/features/students/merged";
import { PORTFOLIO_MONTHS } from "../model/build";
import { kstDateOf } from "../model/dates";
import { referenceMonthsAfter } from "../model/pre-record";
import type {
  PortfolioSnapshot, PreRecordPolicy, SnapshotAttendance, SnapshotClass, SnapshotConsultation, SnapshotDelegation,
  SnapshotAttendanceTouch, SnapshotEnrollment, SnapshotInvoice, SnapshotMakeup, SnapshotReferral, SnapshotReport, SnapshotReview, SnapshotSchedule, SnapshotTerm,
  SnapshotTransition, SnapshotUser,
} from "../model/types";

/**
 * 직원 포트폴리오 계산의 입력 — 한 지점의 최근 7개월 원자료.
 *
 * 🔴 admin 클라이언트 전용(cron은 세션이 없고, 화면 갱신도 같은 길을 쓴다) → **모든 조회에 tenant_id를 적는다**.
 * 🔴 전건이 필요한 표는 `.order(id)` + `.range` 페이징이다. 1,000행에서 조용히 잘리면 점수가 틀린다(B2).
 * ⚠️ 연락처·상담 본문·보고서 본문·급여는 읽지 않는다. 출결 메모는 보강 대조에만 쓰고 결과에 싣지 않는다.
 * ⚠️ 테스트 학생(`is_test`)의 기록은 뺀다.
 * ⚠️ 학원 설정(휴원일·과목·보고서 과목)은 호출부가 읽어서 넘긴다 — 이 파일은 조회만 한다.
 */

/** 보강 기한(결석 다음 달 같은 날)을 대조하려면 표시 범위보다 앞선 결석이 필요하다. */
const ATTENDANCE_LEAD_DAYS = 62;
const SCHEDULE_COLUMNS = "id, class_id, day_of_week, start_time, end_time, teacher_id, slot_teacher_label, lab_separate, valid_from, valid_to";
const REPORT_COLUMNS = "id, student_id, class_id, report_date, created_by, created_at, covers_date, makeup";
const CONSULT_COLUMNS = "id, student_id, counselor_id, follow_up_date, follow_up_done, consulted_at, updated_at";
const MAKEUP_COLUMNS = "id, student_id, class_id, absence_date, makeup_date, status, done_at";
const REFERRAL_COLUMNS = "id, referrer_student_id, referrer_staff_id, consultation_date, received_date, created_at, subject, student_id, prospect_name, prospect_school, prospect_grade";
const dayStartIso = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`).toISOString();
const byId = <T extends { id: string }>(...lists: T[][]): T[] => [...new Map(lists.flat().map((row) => [row.id, row])).values()];

type Admin = SupabaseClient;
type ReviewDocRow = { id: string; staff_user_id: string | null; form_data: Record<string, unknown> | null };
type TransitionRow = {
  target_label: string | null; created_at: string; class_id: string | null; teacher_id: string | null;
  previous_teacher_id: string | null; effective_date: string | null;
};

const paged = <T,>(run: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) =>
  fetchAllPaged<T>(run as (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>);

function reviewOf(row: ReviewDocRow): SnapshotReview {
  const doc = row.form_data ?? {};
  const header = (doc.header ?? null) as { teacherId?: string | null } | null;
  const sheets = (doc.submissions ?? {}) as Record<string, { scores?: unknown; submittedAt?: string | null; completedAt?: string | null; by?: { id?: string | null } | null }>;
  return {
    id: row.id, staff_user_id: row.staff_user_id, header: header ? { teacherId: header.teacherId ?? null } : null, areas: doc.areas ?? null,
    template_name: typeof doc.templateName === "string" ? doc.templateName : null,
    // 채점 코멘트는 싣지 않는다 — 점수와 제출 시각만.
    submissions: Object.fromEntries(Object.entries(sheets).map(([key, sheet]) => [
      key, { scores: sheet?.scores, submittedAt: sheet?.submittedAt ?? null, completedAt: sheet?.completedAt ?? null, byId: sheet?.by?.id ?? null },
    ])),
  };
}

/**
 * 이 지점이 그 기록을 처음 입력한 날(한국 날짜). 기록이 없으면 null.
 * 점수 계산과 같은 행만 본다 — 테스트 학생·회수한 보고서·자리(LAB·JJ) 출결은 시작일을 앞당기지 못한다.
 */
async function firstRecordDay(admin: Admin, tenantId: string, kind: "report" | "attendance", testStudents: ReadonlySet<string>): Promise<string | null> {
  const PAGE = 500;
  for (let from = 0; from < PAGE * 20; from += PAGE) {
    const query = kind === "report"
      ? admin.from("lesson_reports").select("student_id, at:created_at").eq("tenant_id", tenantId).is("revoked_at", null).not("created_at", "is", null)
        .order("created_at").order("id")
      : admin.from("attendance_records").select("student_id, at:recorded_at").eq("tenant_id", tenantId).is("seat_label", null)
        .or("recorded_via.is.null,recorded_via.neq.seat").order("recorded_at").order("id");
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(`첫 기록 조회 실패(${kind}): ${error.message}`);
    const rows = (data ?? []) as unknown as { student_id: string; at: string }[];
    const first = rows.find((r) => !testStudents.has(r.student_id));
    if (first) return kstDateOf(first.at);
    if (rows.length < PAGE) return null;
  }
  // 앞쪽이 전부 테스트 학생 기록이면 '기록 없음'으로 읽어 기록 전 달 규칙이 조용히 사라진다 — 멈추고 알린다.
  throw new Error(`첫 기록 조회 실패(${kind}): 앞쪽 ${PAGE * 20}건이 모두 테스트 학생 기록입니다`);
}

/**
 * 기록을 시작하기 전에 끝난 달의 처리 — 시작일은 지점의 첫 입력일에서, 기준 달은 그다음 온전한 두 달.
 * 창 안의 달이 모두 시작 이후면 규칙이 필요 없다(null).
 */
function preRecordPolicy(from: string, firstReport: string | null, firstAttendance: string | null): PreRecordPolicy | null {
  const policy: PreRecordPolicy = {};
  if (firstReport && firstReport > from) policy.report = { before: firstReport, reference: referenceMonthsAfter(firstReport) };
  if (firstAttendance && firstAttendance > from) policy.attendance = { before: firstAttendance, reference: referenceMonthsAfter(firstAttendance) };
  return policy.report || policy.attendance ? policy : null;
}

const ENROLLMENT_COLUMNS = "id, student_id, class_id, start_date, end_date, on_hold, attendance_days, is_transferred, is_transferred_in, withdrawal_reason";

export async function loadPortfolioSnapshot(
  admin: Admin, tenantId: string,
  input: { end: string; now: Date; settings: PortfolioSnapshot["settings"]; /** 출결 입력·수정 기록을 읽을 첫날(마감 안 한 가장 이른 달 1일). 없으면 안 읽는다. */ touchesSince?: string },
): Promise<PortfolioSnapshot> {
  const { end, touchesSince } = input;
  const endMonth = monthOf(end);
  const fromMonth = shiftMonth(endMonth, -(PORTFOLIO_MONTHS - 1));
  const from = monthRange(fromMonth).from;
  const billingEnd = monthRange(endMonth).to;
  const attendanceFrom = addDays(from, -ATTENDANCE_LEAD_DAYS);
  const table = (name: string) => admin.from(name);
  const inTenant = (name: string, columns: string) => table(name).select(columns).eq("tenant_id", tenantId);

  const [
    tenantRes, testStudents, users, classes, liveSchedules, endedSchedules, enrollments, attendance, reportsByDate,
    reportsByCover, followUps, consulted, reviewDocs, transitions, delegations, invoices, makeupByAbsence, makeupByDate,
    futureEnrollments, studentReasons, referrals, touches,
  ] = await Promise.all([
    table("tenants").select("id, name").eq("id", tenantId).maybeSingle(),
    // 병합 표식은 접두로 먼저 좁히고 모양으로 다시 본다(`isMergedStudent` — 사람이 쓴 '중복 병합: 확인 요망' 메모는 병합이 아니다).
    paged<{ id: string; is_test: boolean | null; notes: string | null }>((a, b) => inTenant("students", "id, is_test, notes").or(`is_test.eq.true,notes.like.${MERGE_NOTE_PREFIX}%`).order("id").range(a, b)),
    paged<SnapshotUser>((a, b) => inTenant("users", "id, display_name, status, subjects").order("id").range(a, b)),
    paged<SnapshotClass>((a, b) => inTenant("classes", "id, class_name, subject, english_track, teacher_id, is_active, closed_at, report_optout, is_makeup_pool, is_special").order("id").range(a, b)),
    // 시간표는 이력을 함께 담는다(#88). 창과 겹치는 배치만 — 끝이 없는 것과 창 안에서 끝난 것.
    paged<SnapshotSchedule>((a, b) => inTenant("class_schedules", SCHEDULE_COLUMNS).lte("valid_from", billingEnd).is("valid_to", null).order("id").range(a, b)),
    paged<SnapshotSchedule>((a, b) => inTenant("class_schedules", SCHEDULE_COLUMNS).lte("valid_from", billingEnd).gte("valid_to", attendanceFrom).order("id").range(a, b)),
    paged<SnapshotEnrollment>((a, b) => inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", billingEnd).order("id").range(a, b)),
    paged<SnapshotAttendance>((a, b) => inTenant("attendance_records", "id, class_id, student_id, session_date, slot_start, status, recorded_at, supersedes_id, seat_label, recorded_via, taught_by, note, recorded_by").gte("session_date", attendanceFrom).lte("session_date", end).order("id").range(a, b)),
    paged<SnapshotReport>((a, b) => inTenant("lesson_reports", REPORT_COLUMNS).is("revoked_at", null).gte("report_date", from).lte("report_date", end).order("id").range(a, b)),
    paged<SnapshotReport>((a, b) => inTenant("lesson_reports", REPORT_COLUMNS).is("revoked_at", null).gte("covers_date", from).lte("covers_date", end).order("id").range(a, b)),
    paged<SnapshotConsultation>((a, b) => inTenant("student_consultations", CONSULT_COLUMNS).gte("follow_up_date", from).lte("follow_up_date", end).order("id").range(a, b)),
    paged<SnapshotConsultation>((a, b) => inTenant("student_consultations", CONSULT_COLUMNS).gte("consulted_at", dayStartIso(from)).lt("consulted_at", dayStartIso(addDays(end, 1))).order("id").range(a, b)),
    paged<ReviewDocRow>((a, b) => inTenant("academy_documents", "id, staff_user_id, form_data").eq("form_type", "class_review").order("id").range(a, b)),
    paged<TransitionRow>((a, b) => inTenant("audit_logs", "target_label, created_at, class_id:metadata->>classId, teacher_id:metadata->>newTeacherId, previous_teacher_id:metadata->>previousTeacherId, effective_date:metadata->>effectiveDate")
      .in("action", ["class_handover_apply", "class_update"]).not("metadata->>newTeacherId", "is", null).order("created_at").order("id").range(a, b)),
    paged<SnapshotDelegation>((a, b) => inTenant("class_delegations", "class_id, delegate_user_id, from_date, to_date").is("revoked_at", null).lte("from_date", end).gte("to_date", from).order("id").range(a, b)),
    paged<SnapshotInvoice>((a, b) => inTenant("invoices", "id, student_id, period, amount_total, amount_discount, line_items").neq("status", "void").eq("category", "tuition").gte("period", fromMonth).lte("period", endMonth).order("id").range(a, b)),
    paged<SnapshotMakeup>((a, b) => inTenant("makeup_reservations", MAKEUP_COLUMNS).gte("absence_date", attendanceFrom).lte("absence_date", end).order("id").range(a, b)),
    paged<SnapshotMakeup>((a, b) => inTenant("makeup_reservations", MAKEUP_COLUMNS).gte("makeup_date", attendanceFrom).lte("makeup_date", end).order("id").range(a, b)),
    // 퇴원율 — 창 끝 다음 한 달 안에 시작하는 수강(말일에 끝나고 1일에 같은 과목 반을 시작한 학생) · 학생의 퇴원 사유(퇴원관리와 같은 곳).
    paged<SnapshotEnrollment>((a, b) => inTenant("enrollments", ENROLLMENT_COLUMNS).gt("start_date", billingEnd).lte("start_date", addDays(billingEnd, 31)).order("id").range(a, b)),
    paged<{ id: string; reason: string | null }>((a, b) => inTenant("students", "id, reason:withdrawal_metadata->>reason").not("withdrawal_metadata", "is", null).order("id").range(a, b)),
    // 원생 소개(0362a) — 소개한 사람이 이어진 상담 전부(같은 사람 판정에 창 밖 상담도 필요하다).
    // 칸이 아직 없는 DB(0362a 적용 전)만 빈 목록 — 집계 전체를 멈추지 않는다(#95). 다른 오류는 다른 조회처럼 멈춘다(마감 날 0건으로 굳지 않게).
    paged<SnapshotReferral>((a, b) => inTenant("enrollment_consultations", REFERRAL_COLUMNS)
      .or("referrer_student_id.not.is.null,referrer_staff_id.not.is.null").order("id").range(a, b))
      .catch((e: unknown) => {
        if (e instanceof Error && /referrer_\w+ does not exist/.test(e.message)) return [] as SnapshotReferral[];
        throw e;
      }),
    // 출결 입력·수정 기록(활동 기록) — 보고서·출결 당일·본인 규칙. 마감한 달은 굳어 다시 안 쓰므로 마감 안 한 달부터만(무겁다).
    touchesSince
      ? paged<{ row_id: string; actor_id: string; created_at: string }>((a, b) => inTenant("activity_log", "row_id, actor_id, created_at")
        .eq("table_name", "attendance_records").in("op", ["INSERT", "UPDATE"]).not("actor_id", "is", null).not("row_id", "is", null)
        .gte("created_at", dayStartIso(touchesSince)).order("created_at").order("id").range(a, b))
      : Promise.resolve([]),
  ]);
  if (tenantRes.error || !tenantRes.data) throw new Error(`지점 조회 실패: ${tenantRes.error?.message ?? "없는 지점"}`);

  const test = new Set(testStudents.filter((s) => s.is_test || isMergedStudent(s.notes)).map((s) => s.id));
  const [firstReport, firstAttendance] = await Promise.all([
    firstRecordDay(admin, tenantId, "report", test),
    firstRecordDay(admin, tenantId, "attendance", test),
  ]);
  const real = <T extends { student_id: string }>(rows: T[]) => rows.filter((row) => !test.has(row.student_id));
  const tuition = real(invoices);
  const terms = await fetchAllPagedInChunks<SnapshotTerm>(tuition.map((i) => i.id), (chunk, a, b) =>
    table("invoice_session_terms")
      .select("id, invoice_id, class_id, amount, confirmed_sessions, allocation_line_index, allocation_amount, allocation_source, allocation_base_amount")
      .eq("tenant_id", tenantId).in("invoice_id", chunk).order("id").range(a, b));

  return {
    tenant: { id: tenantRes.data.id as string, name: (tenantRes.data.name as string) ?? "" },
    capturedAt: input.now.toISOString(),
    from, end,
    settings: input.settings,
    preRecord: preRecordPolicy(from, firstReport, firstAttendance),
    users, classes,
    schedules: byId(liveSchedules, endedSchedules),
    enrollments: real(enrollments),
    attendance: real(attendance),
    reports: real(byId(reportsByDate, reportsByCover)),
    consultations: real(byId(followUps, consulted)),
    reviews: reviewDocs.map(reviewOf),
    transitions: transitions.flatMap((t): SnapshotTransition[] => {
      const date = t.effective_date?.slice(0, 10) || kstDateOf(t.created_at);
      return t.teacher_id && date ? [{ class_id: t.class_id, target_label: t.target_label, teacher_id: t.teacher_id, previous_teacher_id: t.previous_teacher_id, date }] : [];
    }),
    delegations, invoices: tuition, terms,
    makeupLegacy: real(byId(makeupByAbsence, makeupByDate)),
    futureEnrollments: real(futureEnrollments), studentReasons,
    attendanceTouches: touches.flatMap((t): SnapshotAttendanceTouch[] => { const day = kstDateOf(t.created_at); return day ? [{ row_id: t.row_id, actor_id: t.actor_id, day }] : []; }),
    referrals: referrals.filter((r) => !(r.student_id && test.has(r.student_id)) && !(r.referrer_student_id && test.has(r.referrer_student_id))),
  };
}
