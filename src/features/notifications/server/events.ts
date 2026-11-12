import "server-only";
/**
 * Phase 3 이벤트 감지·발송 — cron(daily-briefing 라우트)에서 테넌트별 호출. service_role(admin) 경로.
 *
 * 불변식(적대 리뷰 반영):
 * - **콜드스타트 무발송 시드**: (tenant, event_type) 행이 0건이면 첫 실행 — 현재 감지분 전부 seeded=true로
 *   기록만 하고 발송 스킵(벨 폭탄 방지, 0108a 철학). 그다음 실행부터 신규 edge만 알린다.
 * - **원자 dedup**: upsert(onConflict, ignoreDuplicates).select()가 돌려준 **신규 삽입 행만** 발송 대상
 *   (bulk insert는 한 행 충돌로 문장 전체 실패 → 신규분 분리 불가). record-first.
 * - **수신자**: 결석 = master만(원장 결정 '운영 벨=master', 마일스톤이라 저빈도) 집계 1건.
 *   후속조치 = 담당 상담사(counselor_id, status active) 폴백 master. admin RLS 우회라 tenant 필터 필수.
 * - notifyUsers는 best-effort(throw 안 함) — 이벤트 기록 후 발송 실패 시 재시도 없음(드문 silent 유실 감수,
 *   중복 스팸보다 낫다는 판단). actorId=null(시스템 이벤트).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report-error";
import { addDays, kstDateOf, kstToday } from "@/lib/date-kst";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import { getAbsenceRiskStudents } from "@/features/dashboard/server/queries";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { notifyUsers, type NotifyInput } from "./notify";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isModuleEnabled } from "@/lib/modules";
import {
  classnoteMinDate,
  classnoteRetryDeadline,
  isClassnoteAllowed,
  isClassnoteSubjectEnabled,
} from "@/features/onescreen/classnote-guard";
import { absenceKeyOf, getAbsenceBlockedKeys } from "@/features/onescreen/server/absence-gate";
import { fetchReportOptoutClassIds } from "@/features/classes/server/report-optout-ids";
import { UNSENT_FILTER } from "@/features/report-admin/report-filters";
import { filterUnsentSendable, type UnsentRow } from "@/features/report-admin/unsent-sendable";
import { getTestStudentIds } from "@/features/students/server/test-students";
import { buildSheetDraft, type SheetPlanLine } from "@/features/class-sheets/sheet-report-draft";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import { stripTextbookPages } from "@/features/onescreen/textbook-carry";
import type { TodaysMathFillRow } from "@/features/onescreen/todays-math-fill-rules";
import { isFeatureOptedIn } from "@/lib/license/server";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import {
  absenceDigestBody,
  absenceNotificationLink,
  buildAbsenceEvents,
  buildFollowupEvents,
  buildGradeDropEvents,
  buildOutstandingEvents,
  buildProgressAnomalyEvents,
  buildSendDeadlineEvents,
  planUnsentAlerts,
  splitRecordedUnsent,
  unsentSendWindowEnd,
  unsentTeacherDigestBody,
  type UnsentPriorEvent,
  type UnsentRouting,
  draftPriorForReports,
  eligibleUnsentDrafts,
  unsentDraftDigestBody,
  unsentDraftLink,
  unsentDraftSavedIndex,
  unsentDraftUnits,
  unsentDraftUsualClasses,
  UNSENT_DRAFT_HISTORY_DAYS,
  isUnsentQuietDay,
  pickDraftUnitPerKey,
  unsentDraftDirectInput,
  todaysMathAutoScores,
  type DraftAutoValues,
  type DraftUnit,
  followupBody,
  weekKey,
  buildEnrollmentFollowupEvents,
  seedsOnColdStart,
  enrollmentFollowupBody,
  enrollmentFollowupTitle,
  type EnrollmentFollowupEvent,
  gradeDropDigestBody,
  groupEventsByTeacher,
  outstandingDigestBody,
  groupProgressAnomalyByStudent,
  progressAnomalyLink,
  progressAnomalyStudentBody,
  sendDeadlineBody,
  sendDeadlineDigestBody,
  unsentReportDigestBody,
  UNSENT_REPORT_WINDOW_DAYS,
  type AbsenceEvent,
  type FollowupEvent,
  type GradeDropEvent,
  type GradeRow,
  type OutstandingEvent,
  type ProgressAnomalyEvent,
  type SendDeadlineEvent,
  type UnsentReportEvent,
} from "../events-core";
import { classnoteSendOn } from "@/features/owner/classnote-gate";
import { taskIdsFor } from "@/features/staff-tasks/server/link";
import { FOLLOW_UP_ALERT_START, FOLLOW_UP_OPEN_OUTCOMES } from "@/features/enrollment/follow-up";

type EventType =
  | "absence_alert"
  | "followup_due"
  | "enrollment_followup"
  | "grade_drop"
  | "outstanding_alert"
  | "unsent_report"
  | "progress_anomaly"
  // 발송 실패 보고서의 **재발송 마지막 날**(실패 자체는 0143a 트리거+스윕이 이미 알린다).
  | "send_deadline"
  // 저장 안 된 수업 보고서(원스크린에 입력만 함, 2026-11-06) — 알림 type은 unsent_report 그대로, 기록·콜드스타트만 따로.
  | "unsent_draft";
type EventRow = { tenant_id: string; event_type: EventType; subject_key: string; bucket: string; seeded: boolean };
/** admin client(RLS 우회)를 쿠키-클라 시그니처 db 주입에 넘길 때의 캐스트 별칭(briefing.ts 선례). */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * (tenant, event_type)에 기록된 이벤트가 하나도 없으면 콜드스타트(첫 실행).
 * 시드를 하지 않는 종류(`seedsOnColdStart` — 신규 콜&상담 후속 조치)는 늘 false — 첫 실제 알림이 시드로 삼켜지지 않게.
 */
async function isColdStart(admin: SupabaseClient, tenantId: string, eventType: EventType): Promise<boolean> {
  if (!seedsOnColdStart(eventType)) return false;
  const { count, error } = await admin
    .from("notification_events")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("event_type", eventType);
  if (error) throw new Error(`isColdStart ${eventType}: ${error.message}`);
  return (count ?? 0) === 0;
}

/**
 * 이벤트 후보를 dedup 기록하고 신규 삽입분만 반환. seeded=true면 발송 안 할 시드.
 * upsert ignoreDuplicates.select() = 새로 들어간 행만 돌려줌(이미 있던 건 제외 = 재발송 차단).
 */
async function recordNew<E extends { subjectKey: string; bucket: string }>(
  admin: SupabaseClient,
  tenantId: string,
  eventType: EventType,
  candidates: readonly E[],
  seeded: boolean,
): Promise<E[]> {
  if (candidates.length === 0) return [];
  const rows: EventRow[] = candidates.map((c) => ({
    tenant_id: tenantId,
    event_type: eventType,
    subject_key: c.subjectKey,
    bucket: c.bucket,
    seeded,
  }));
  const { data, error } = await admin
    .from("notification_events")
    .upsert(rows, { onConflict: "tenant_id,event_type,subject_key,bucket", ignoreDuplicates: true })
    .select("subject_key, bucket");
  if (error) throw new Error(`recordNew ${eventType}: ${error.message}`);
  const inserted = new Set((data ?? []).map((r) => `${r.subject_key}::${r.bucket}`));
  return candidates.filter((c) => inserted.has(`${c.subjectKey}::${c.bucket}`));
}

/** 지정 역할(활성) 수신자 id 목록 — admin RLS 우회라 tenant 필터 필수. */
async function activeRoleIds(admin: SupabaseClient, tenantId: string, roles: readonly string[]): Promise<string[]> {
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("system_role", [...roles])
    .eq("status", "active");
  if (error) throw new Error(`activeRoleIds: ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.id as string))];
}

/**
 * 담당 강사가 없는 이벤트만 — 원장 2026-10-29 *"내가 언급된 일 말고는 전부 알림 꺼버려 … 내 학생 내 반 이런거 있잖아. 나와 관련있는 알림만."*
 * 역할 전원 사본은 없앴다. 담당 강사가 받는 건은 원장에게 가지 않고, 담당 강사가 없는 학생 건만 원장이 받는다(아무에게도 안 가는 일이 없게).
 */
function withoutTeacher<E extends { subjectKey: string }>(
  events: readonly E[],
  studentTeachers: ReadonlyMap<string, readonly string[]>,
  studentIdOf: (event: E) => string = (event) => event.subjectKey,
): E[] {
  return events.filter((event) => !(studentTeachers.get(studentIdOf(event))?.length));
}

/** 반 → 재직 담임(본 테넌트·운영 중 반). 보고서처럼 반이 정해진 건의 '담당 강사 없음' 판정용. */
async function activeClassTeachers(admin: SupabaseClient, tenantId: string, classIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(classIds.filter(Boolean))];
  if (!unique.length) return out;
  const classes = await fetchInChunks<{ id: string; teacher_id: string | null; is_active: boolean }>(unique, (chunk) =>
    admin.from("classes").select("id, teacher_id, is_active").eq("tenant_id", tenantId).in("id", chunk));
  const live = await activeUserIds(admin, tenantId, classes.flatMap((c) => (c.is_active && c.teacher_id ? [c.teacher_id] : [])));
  for (const c of classes) if (c.is_active && c.teacher_id && live.has(c.teacher_id)) out.set(c.id, c.teacher_id);
  return out;
}

/** master(활성) 수신자 id 목록. */
function activeMasterIds(admin: SupabaseClient, tenantId: string): Promise<string[]> {
  return activeRoleIds(admin, tenantId, ["master"]);
}

/** 활성 사용자 id 집합(수신자 유효성 검증용) — counselor가 퇴직/비활성이면 폴백 판정에 씀. */
async function activeUserIds(admin: SupabaseClient, tenantId: string, ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Set();
  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("id", unique);
  if (error) throw new Error(`activeUserIds: ${error.message}`);
  return new Set((data ?? []).map((r) => r.id as string));
}

/**
 * 학생 → **담당 강사(활성)** 역매핑(v2). 활성 수강(반) 기준: enrollments(활성) → classes(본 테넌트·
 * is_active·teacher_id) → users(활성). ⚠️ admin RLS 우회라 enrollments·classes 둘 다 tenant 필터 필수
 * (notifyClassAssignment 적대리뷰 HIGH: 조작된 타 테넌트 class_id로 외부 강사 누수 차단).
 * 반환 = studentId → 담당 강사 id 목록(중복 제거).
 */
async function getStudentActiveTeachers(
  admin: SupabaseClient,
  tenantId: string,
  studentIds: readonly string[],
  today: string,
  // 과목 스코프(선택) — 지정하면 그 과목 반의 담당 강사만 매핑. 진도 이상(수학 전용 파이프라인)처럼
  // "그 강사가 실제로 할 수 있는 행동"이 특정 과목에 묶인 이벤트에 사용(#77형 거짓 재촉 방지, 리뷰 확정).
  // 미지정 = 기존 동작(전 과목 담당 강사 — 결석·성적처럼 과목 무관 관심사).
  subjectScope?: readonly string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (studentIds.length === 0) return result;

  const enrollments = await fetchInChunks<{
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
  }>([...studentIds], (chunk) =>
    admin
      .from("enrollments")
      .select("student_id, class_id, start_date, end_date, on_hold, is_transferred")
      .eq("tenant_id", tenantId)
      .in("student_id", chunk),
  );
  const active = enrollments.filter((row) =>
    isEnrollmentActiveOn(
      { startDate: row.start_date, endDate: row.end_date, onHold: row.on_hold, isTransferred: row.is_transferred },
      today,
    ),
  );
  const classIds = [...new Set(active.map((row) => row.class_id))];
  if (classIds.length === 0) return result;

  // 반 → 담당 강사(본 테넌트·운영 중). teacher_id null(미지정)·타 테넌트·폐지 반·(스코프 지정 시) 타 과목 반 제외.
  const classes = await fetchInChunks<{
    id: string;
    teacher_id: string | null;
    tenant_id: string;
    is_active: boolean;
    subject: string | null;
  }>(classIds, (chunk) => admin.from("classes").select("id, teacher_id, tenant_id, is_active, subject").in("id", chunk));
  const teacherByClass = new Map<string, string>();
  const teacherIds = new Set<string>();
  for (const klass of classes) {
    if (klass.tenant_id !== tenantId || !klass.is_active || !klass.teacher_id) continue;
    if (subjectScope && (!klass.subject || !subjectScope.includes(klass.subject))) continue;
    teacherByClass.set(klass.id, klass.teacher_id);
    teacherIds.add(klass.teacher_id);
  }
  const activeTeachers = await activeUserIds(admin, tenantId, [...teacherIds]);

  for (const row of active) {
    const teacherId = teacherByClass.get(row.class_id);
    if (!teacherId || !activeTeachers.has(teacherId)) continue;
    const list = result.get(row.student_id) ?? [];
    if (!list.includes(teacherId)) list.push(teacherId);
    result.set(row.student_id, list);
  }
  return result;
}

/** 결석 마일스톤 감지 → master 집계 + **담당 강사(v2)** 알림(콜드스타트면 시드만). */
async function detectAbsence(admin: SupabaseClient, tenantId: string): Promise<number> {
  const risks = await getAbsenceRiskStudents({ supabase: admin as unknown as ServerClient, tenantId });
  const candidates = buildAbsenceEvents(
    risks.map((r) => ({ studentId: r.studentId, studentName: r.studentName, absences: r.absences })),
  );
  const cold = await isColdStart(admin, tenantId, "absence_alert");
  const fresh = await recordNew(admin, tenantId, "absence_alert", candidates, cold);
  if (cold || fresh.length === 0) return 0;

  const freshEvents = fresh as AbsenceEvent[];
  if (!absenceDigestBody(freshEvents)) return 0;

  const items: NotifyInput[] = [];
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(freshEvents.map((event) => event.subjectKey))],
    kstToday(),
  );
  // ① 원장 = 담당 강사가 없는 학생 건만 집계 1건(나와 관련 있는 알림만 — 원장 2026-10-29).
  const orphan = withoutTeacher(freshEvents, studentTeachers);
  const masterBody = absenceDigestBody(orphan);
  if (masterBody) {
    for (const recipientId of await activeMasterIds(admin, tenantId)) {
      items.push({
        tenantId,
        recipientId,
        type: "absence_alert",
        title: "반복 결석 학생",
        body: masterBody,
        link: absenceNotificationLink(orphan),
        actorId: null,
      });
    }
  }
  // ② v2 — 담당 강사 = 자기 학생 신규 이벤트만 집계 1건(스코프 격리, 활성 강사만).
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(freshEvents, studentTeachers)) {
    const body = absenceDigestBody(teacherEvents);
    if (!body) continue;
    items.push({
      tenantId,
      recipientId: teacherId,
      type: "absence_alert",
      title: "담당 학생 반복 결석",
      body,
      link: absenceNotificationLink(teacherEvents),
      actorId: null,
    });
  }
  await notifyUsers(items);
  return fresh.length;
}

/** 상담 후속조치 기한 감지 → 담당 상담사(폴백 master) 개별 알림(콜드스타트면 시드만). */
async function detectFollowup(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  // 전용 감지 쿼리 — getFollowUpConsultations의 .limit(60) 하드캡을 피하고 counselor_id를 함께 받는다.
  // 🔴 B9(수정 계획 P2-R): 지난 미완료가 쌓이면 오래된 순 1,000행에서 잘려 **오늘 건**이 빠졌다(#54) → 페이지로 전건.
  type FollowupRow = { id: string; follow_up_date: string; counselor_id: string | null; student: { name?: string } | { name?: string }[] | null };
  const data = await fetchAllPaged<FollowupRow>((from, to) =>
    admin
      .from("student_consultations")
      .select("id, follow_up_date, counselor_id, student:student_id ( name )")
      .eq("tenant_id", tenantId)
      .eq("follow_up_done", false)
      .not("follow_up_date", "is", null)
      .lte("follow_up_date", today) // 오늘 이하 = today(due) 또는 overdue만(soon/later 제외)
      .order("follow_up_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: FollowupRow[] | null; error: { message: string } | null }>,
  ).catch((e: unknown) => {
    throw new Error(`detectFollowup query: ${e instanceof Error ? e.message : String(e)}`);
  });

  const candidates = buildFollowupEvents(
    (data ?? []).map((row) => {
      const student = (Array.isArray(row.student) ? row.student[0] : row.student) as { name?: string } | undefined;
      const date = (row.follow_up_date as string).slice(0, 10);
      return {
        consultationId: row.id as string,
        studentName: student?.name ?? "(학생)",
        followUpDate: date,
        counselorId: (row.counselor_id as string | null) ?? null,
        urgency: followUpUrgency(date, false, today),
      };
    }),
    weekKey(today), // overdue 주간 재알림 bucket 성분
  );
  const cold = await isColdStart(admin, tenantId, "followup_due");
  const fresh = (await recordNew(admin, tenantId, "followup_due", candidates, cold)) as FollowupEvent[];
  if (cold || fresh.length === 0) return 0;

  const [masters, activeCounselors, taskIds] = await Promise.all([
    activeMasterIds(admin, tenantId),
    activeUserIds(admin, tenantId, fresh.map((event) => event.counselorId).filter((id): id is string => Boolean(id))),
    // 할 일(0377a) — 회차 = 후속조치 기한. 알림이 그 할 일을 가리키게 한다(벨이 처리 상태를 붙인다).
    taskIdsFor(admin, tenantId, "followup_due", fresh.map((event) => event.subjectKey)),
  ]);
  const items: NotifyInput[] = [];
  for (const event of fresh) {
    // 담당 상담사가 유효(활성)하면 개인에게, 아니면 master 전원 폴백.
    const recipients =
      event.counselorId && activeCounselors.has(event.counselorId) ? [event.counselorId] : masters;
    for (const recipientId of recipients) {
      items.push({
        tenantId,
        recipientId,
        type: "followup_due",
        title: event.stage === "due" ? "오늘 마감 상담 후속조치" : "기한 지난 상담 후속조치",
        body: followupBody(event),
        link: "/consultations",
        actorId: null,
        taskId: taskIds.get(`${event.subjectKey}|${event.followUpDate}`) ?? null,
      });
    }
  }
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 신규 콜&상담 후속 조치 감지(원장 2026-10-22 *"후속조치일 다와가면 알람 기능"*) → 상담자(재직 중이 아니면 원장 전원) 개별 알림.
 * 하루 전 · 당일 · 지나면(주 1회). 아직 정하지 않은 상담(상담 전·상담 완료)만 · 도입일 이후 날짜만(follow-up.ts — DB 할 일과 같은 목록).
 * 당일·지남 알림은 할 일(0441a `enrollment_followup`)을 가리킨다 — 하루 전엔 아직 할 일이 없다.
 * 콜드스타트 시드는 하지 않는다(`seedsOnColdStart` — 첫 실행의 첫 알림도 보낸다, 2026-10-23).
 */
async function detectEnrollmentFollowup(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const rows = await fetchAllPaged<{ id: string; prospect_name: string | null; follow_up_date: string; consultant_id: string | null; follow_up_content: string | null }>(
    (from, to) =>
      admin
        .from("enrollment_consultations")
        .select("id, prospect_name, follow_up_date, consultant_id, follow_up_content")
        .eq("tenant_id", tenantId)
        .in("outcome", [...FOLLOW_UP_OPEN_OUTCOMES])
        .not("follow_up_date", "is", null)
        .gte("follow_up_date", FOLLOW_UP_ALERT_START)
        .lte("follow_up_date", tomorrow)
        .order("id")
        .range(from, to),
  );
  const candidates = buildEnrollmentFollowupEvents(
    rows.map((row) => ({
      consultationId: row.id,
      prospectName: row.prospect_name?.trim() || "(이름 없음)",
      followUpDate: row.follow_up_date.slice(0, 10),
      consultantId: row.consultant_id,
      content: row.follow_up_content,
    })),
    today,
    weekKey(today),
  );
  const cold = await isColdStart(admin, tenantId, "enrollment_followup");
  const fresh = (await recordNew(admin, tenantId, "enrollment_followup", candidates, cold)) as EnrollmentFollowupEvent[];
  if (cold || fresh.length === 0) return 0;

  const [masters, activeConsultants, taskIds] = await Promise.all([
    activeMasterIds(admin, tenantId),
    activeUserIds(admin, tenantId, fresh.map((event) => event.consultantId).filter((id): id is string => Boolean(id))),
    taskIdsFor(admin, tenantId, "enrollment_followup", fresh.map((event) => event.subjectKey)),
  ]);
  const items: NotifyInput[] = [];
  for (const event of fresh) {
    const recipients =
      event.consultantId && activeConsultants.has(event.consultantId) ? [event.consultantId] : masters;
    for (const recipientId of recipients) {
      items.push({
        tenantId,
        recipientId,
        type: "enrollment_followup",
        title: enrollmentFollowupTitle(event.stage),
        body: enrollmentFollowupBody(event),
        link: `/enrollment/${event.subjectKey}`,
        actorId: null,
        taskId: taskIds.get(`${event.subjectKey}|${event.followUpDate}`) ?? null,
      });
    }
  }
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 성적 급락 감지(같은 과목 최신 vs 직전 ≥15점 하락) → master + 담당 강사(콜드스타트면 시드만).
 * ⚠️ injaewon은 현재 성적 0건이라 미발화 — 학원이 성적 입력 시작 시 작동(거짓 알림 0). retention과
 * 동일 180일 창에서 (학생,과목)별 최신 2건 비교. bucket=최신 gradeId라 새 점수 1회만 알린다.
 */
async function detectGradeDrop(admin: SupabaseClient, tenantId: string): Promise<number> {
  // 성적 기록 알림이 아니라 이탈 방어의 위험 신호다: retention 기준을 재사용하고 확인 화면도 /retention 하나다.
  // 기능을 끈 지점에는 후보 조회·이벤트 시드·알림을 모두 남기지 않는다.
  if (!(await isModuleOnForTenant(tenantId, "retention"))) return 0;
  const today = kstToday();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 180 * 86_400_000).toISOString().slice(0, 10);
  const rows = await fetchAllPaged<{
    id: string;
    student_id: string;
    subject: string;
    score: string | null;
    max_score: string | null;
    taken_on: string;
    student: { name?: string } | { name?: string }[] | null;
  }>((from, to) =>
    admin
      .from("student_grades")
      .select("id, student_id, subject, score, max_score, taken_on, student:student_id ( name )")
      .eq("tenant_id", tenantId)
      .gte("taken_on", since)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (rows.length === 0) return 0;

  const settings = await getTenantSettingsByTenantId(tenantId);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gradeDropLink = isModuleEnabled(settings.modules.disabled, "retention") ? "/retention" : null;
  const gradeRows: GradeRow[] = rows.map((row) => {
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) as { name?: string } | undefined;
    const score = row.score == null ? null : Number(row.score);
    const max = row.max_score == null ? null : Number(row.max_score);
    return {
      studentId: row.student_id,
      studentName: student?.name ?? "(학생)",
      subject: row.subject,
      subjectLabel: subjects.labelOf(row.subject) ?? row.subject,
      gradeId: row.id,
      takenOn: row.taken_on.slice(0, 10),
      pct: score != null && max != null && max > 0 ? (score / max) * 100 : null,
    };
  });

  const candidates = buildGradeDropEvents(gradeRows);
  const cold = await isColdStart(admin, tenantId, "grade_drop");
  const fresh = (await recordNew(admin, tenantId, "grade_drop", candidates, cold)) as GradeDropEvent[];
  if (cold || fresh.length === 0) return 0;

  const items: NotifyInput[] = [];
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(fresh.map((event) => event.subjectKey))],
    today,
  );
  // 원장 = 담당 강사가 없는 학생 건만(원장 2026-10-29 '나와 관련 있는 알림만').
  const masterBody = gradeDropDigestBody(withoutTeacher(fresh, studentTeachers));
  if (masterBody) {
    for (const recipientId of await activeMasterIds(admin, tenantId)) {
      items.push({ tenantId, recipientId, type: "grade_drop", title: "성적 급락(담당 강사 없음)", body: masterBody, link: gradeDropLink, actorId: null });
    }
  }
  // 담당 강사 = 자기 학생 성적 급락만(결석 v2와 동일 tenant 격리 역매핑 재사용).
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(fresh, studentTeachers)) {
    const body = gradeDropDigestBody(teacherEvents);
    if (!body) continue;
    items.push({ tenantId, recipientId: teacherId, type: "grade_drop", title: "담당 학생 성적 급락", body, link: gradeDropLink, actorId: null });
  }
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 진도 이상 감지(G2 선알림) — ingest(math 전용)가 남긴 jump_error/overlap_error 이벤트를 담당 강사+master 벨로.
 * grade_drop 동형: recordNew dedup(bucket=`pe:${eventId}` — 이벤트 1건=전이 1회, 앵커일 아님)·콜드스타트 시드·
 * groupEventsByTeacher 라우팅 재사용. regression은 의도적 제외(실측 14일 80건=복습 소음, events-core 참조).
 * 창 = 최근 14일(cron 중단 공백 커버, dedup이 재실행 중복을 흡수). 볼륨 실측 한 자릿수라 스팸 위험 없음.
 */
async function detectProgressAnomaly(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 14 * 86_400_000).toISOString();
  // admin=RLS 우회 → tenant 필터 필수(불변식). 학생 이름은 임베드 조인(grade_drop 패턴).
  const { data, error } = await admin
    .from("progress_events")
    .select("id, student_id, event_type, student:student_id ( name )")
    .eq("tenant_id", tenantId)
    .in("event_type", ["jump_error", "overlap_error"])
    // "이상 없음" 확인분 제외(0151a) — dedup이 이미 재발송을 막지만, dedup이 비워지거나 이벤트가 다시
    // 감지되는 경로에서도 확인 판정이 이겨야 한다(배지·이상 카드와 같은 조건, #77).
    .is("resolved_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(500); // 실측 한 자릿수/14일 — 폭주(버그) 시에도 벨 폭탄 방지 상한
  if (error) throw new Error(`detectProgressAnomaly query: ${error.message}`);
  const candidates = buildProgressAnomalyEvents(
    (data ?? []).map((row) => {
      const student = (Array.isArray(row.student) ? row.student[0] : row.student) as { name?: string } | undefined;
      return {
        studentId: row.student_id as string,
        studentName: student?.name ?? "(학생)",
        eventId: row.id as string,
        eventType: row.event_type as string,
      };
    }),
  );
  const cold = await isColdStart(admin, tenantId, "progress_anomaly");
  const fresh = (await recordNew(admin, tenantId, "progress_anomaly", candidates, cold)) as ProgressAnomalyEvent[];
  if (cold || fresh.length === 0) return 0;

  // ⚠️ **학생 1명 = 알림 1건**(2026-07-27) — 알림은 link가 하나뿐이라 여러 명을 묶으면 "어디서 확인"을
  // 표현할 수 없다. 예전엔 3명 묶음 → link `/students`(전체 목록)라 눌러도 아무 정보가 없었다(원장 제보).
  // 이제 각 알림이 그 학생 **진도 탭**으로 직행한다. 실측 볼륨 14일 한 자릿수라 분할해도 벨 폭탄 아님.
  const byStudent = groupProgressAnomalyByStudent(fresh);
  const items: NotifyInput[] = [];
  // 할 일(0378a '진도 기록 이상') = 이벤트 한 건마다 하나 — 학생별 알림이 그 학생의 이벤트 할 일들을 묶어 알린다.
  const [masterIds, taskByEvent] = await Promise.all([
    activeMasterIds(admin, tenantId),
    taskIdsFor(admin, tenantId, "progress_anomaly", fresh.map(progressEventId)),
  ]);
  const tasksOf = (events: readonly ProgressAnomalyEvent[]) =>
    events.flatMap((event) => taskByEvent.get(`${progressEventId(event)}|`) ?? []);
  // 담당 강사 = 자기 학생의 **수학 반** 강사만(리뷰 확정 #77형: 진도 파이프라인이 math 전용이라
  // 영어만 담당하는 강사에게 보내면 배지도 안 보이고 진도 입력 주체도 아님 = 할 수 없는 일 재촉).
  // "math" = ingest.ts MATH_SUBJECT와 짝(subject_1 등 비math 보고서는 ingest가 skip하므로 이벤트 원천 부재).
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(fresh.map((event) => event.subjectKey))],
    today,
    ["math"],
  );
  // 강사도 같은 딥링크 — `/onescreen`은 **오늘 로스터**에만 배지를 다는데 알림은 다음날 도니, 그 학생이
  // 그날 수업이 없으면 원스크린에도 아무 표시가 없다(같은 "눌렀는데 아무것도 없음"). 진도 탭은 항상 보인다.
  // (강사의 students 권한은 scoped — 알림 수신자 자체가 그 학생 담당 강사라 열람 범위 안.)
  // 원장 = 수학 반 담당 강사가 없는 학생 건만(원장 2026-10-29 '나와 관련 있는 알림만').
  for (const group of byStudent) {
    if (studentTeachers.get(group.studentId)?.length) continue;
    const body = progressAnomalyStudentBody(group.studentName, group.events);
    if (!body) continue;
    for (const recipientId of masterIds) {
      items.push({ tenantId, recipientId, type: "progress_anomaly", title: "진도 기록 이상(담당 강사 없음)", body, link: progressAnomalyLink(group.studentId), actorId: null, taskIds: tasksOf(group.events) });
    }
  }
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(fresh, studentTeachers)) {
    for (const group of groupProgressAnomalyByStudent(teacherEvents)) {
      const body = progressAnomalyStudentBody(group.studentName, group.events);
      if (!body) continue;
      items.push({ tenantId, recipientId: teacherId, type: "progress_anomaly", title: "담당 학생 진도 기록 이상", body, link: progressAnomalyLink(group.studentId), actorId: null, taskIds: tasksOf(group.events) });
    }
  }
  await notifyUsers(items);
  return fresh.length;
}

/** 미발송 할 일을 맞추고 보고서 id → 할 일 id. 실패하면 빈 표(알림은 할 일 연결 없이 그대로). */
async function syncUnsentTasks(
  admin: SupabaseClient,
  tenantId: string,
  reportIds: string[],
  checkedIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await admin.rpc("staff_task_sync_unsent", { p_tenant: tenantId, p_reports: reportIds, p_checked: checkedIds });
  if (error) reportError(error, { scope: "notifications.unsent-tasks", tenantId });
  for (const row of (data ?? []) as { report_id: string; task_id: string }[]) out.set(row.report_id, row.task_id);
  return out;
}

/**
 * 미발송 보고서들의 지난 알림 기록 — 직원 몫 횟수(최대 3번)·오늘 울림 판정(`unsentTeacherAlertHistory`) 재료.
 * 청크 100건 × 보고서당 기록 몇 줄(원장 1회분 + 직원 몫 최대 3 + 시드)이라 한 번에 1,000행 상한 아래다(B2).
 */
async function unsentPriorEvents(admin: SupabaseClient, tenantId: string, reportIds: readonly string[]): Promise<UnsentPriorEvent[]> {
  const rows = await fetchInChunks<{ subject_key: string; bucket: string; seeded: boolean | null; created_at: string | null }>(
    [...reportIds],
    (chunk) =>
      admin
        .from("notification_events")
        .select("subject_key, bucket, seeded, created_at")
        .eq("tenant_id", tenantId) // admin RLS 우회 — 테넌트 필터가 유일한 격리선
        .eq("event_type", "unsent_report")
        .in("subject_key", chunk),
  );
  return rows.map((row) => ({
    subjectKey: row.subject_key,
    bucket: row.bucket,
    seeded: row.seeded === true,
    createdDate: kstDateOf(row.created_at),
  }));
}

/** 진도 이상 이벤트의 progress_events.id — dedup bucket이 `pe:${id}`다(events-core). */
function progressEventId(event: ProgressAnomalyEvent): string {
  return event.bucket.replace(/^pe:/, "");
}

/**
 * 미수 임계 감지(학생별 총 미수가 금액 tier 도달) → master + 회계(활성) 집계(콜드스타트면 시드만).
 * 미수는 학생별이 아니라 청구 도메인 전체라 담당 강사가 아닌 billing 역할(master/accountant)에게 집계 1건.
 */
async function detectOutstanding(admin: SupabaseClient, tenantId: string): Promise<number> {
  // p_tenant 변형(0121a) — 세션용 RPC는 service_role에서 auth_tenant_id() null → silent 0행.
  // 🔴 테스트 학생(`students.is_test` — 발송 시험용 '학원이')은 경보 대상이 아니다(원장 2026-09-13).
  //    **RPC 결과를 JS에서** 거른다 — 이 RPC는 운영실 미수 카드·브리핑·retention이 **함께 읽으므로**
  //    RPC 자체를 고치면 알림만 막으려다 화면 숫자가 같이 바뀐다(그건 별개의 결정이다).
  // ⚠️ 두 조회는 서로 독립이라 병렬(B4).
  const [{ data, error }, testStudentIds] = await Promise.all([
    admin.rpc("dashboard_top_outstanding_admin", { p_limit: 500, p_tenant: tenantId }),
    getTestStudentIds(admin, tenantId),
  ]);
  if (error) throw new Error(`detectOutstanding rpc: ${error.message}`);
  const candidates = buildOutstandingEvents(
    ((data ?? []) as Array<{ student_id: string; student_name: string; amount: number | string }>)
      .filter((row) => !testStudentIds.has(row.student_id))
      .map((row) => ({
        studentId: row.student_id,
        studentName: row.student_name,
        amount: Number(row.amount),
      })),
  );
  const cold = await isColdStart(admin, tenantId, "outstanding_alert");
  const fresh = (await recordNew(admin, tenantId, "outstanding_alert", candidates, cold)) as OutstandingEvent[];
  if (cold || fresh.length === 0) return 0;

  const body = outstandingDigestBody(fresh);
  if (!body) return 0;
  // 딥링크 — 예전엔 `/billing` 하드코딩이라 **당월(kstMonth) 화면**으로만 갔고, 미수는 전 기간 합계라
  // 본문에 적힌 학생 대부분이 그 화면에 없었다(2026-07-19 259명 중 당월 행 보유 14명). 이제:
  //  · 1명 = 그 학생의 수납 탭(기간 무관, 항상 그 학생이 있다)
  //  · 여러 명 = 새 '기한 경과만' 필터가 걸린 수납 목록(적어도 미수 목록에 착지)
  const link =
    fresh.length === 1 ? `/students/${fresh[0]!.subjectKey}?tab=billing` : "/billing?overdue=1";
  // 수납 담당 = 회계(accountant) — 원장 2026-10-29 '나와 관련 있는 알림만'(원장 사본 제거). 회계가 없을 때만 원장.
  const accountants = await activeRoleIds(admin, tenantId, ["accountant"]);
  const recipients = accountants.length ? accountants : await activeMasterIds(admin, tenantId);
  const items: NotifyInput[] = recipients.map((recipientId) => ({
    tenantId,
    recipientId,
    type: "outstanding_alert",
    title: "미수금 주의 학생",
    body,
    link,
    actorId: null,
  }));
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 미발송 보고서 감지(저장만 하고 발송 안 누른 건) → master 집계 + 담당 강사(콜드스타트면 시드만).
 *
 * **게이트는 발송 콘솔(sendClassnoteForUnsent)과 동일**해야 한다 — 안 그러면 "보낼 수 없는 보고서"를
 * 재촉하는 거짓 알림이 된다: ① classnote_status IS NULL(발송 이력 있는 건 PR1 'classnote-attention'
 * 신호 담당) ② revoked 제외 ③ edutrix_import 제외(Edutrix가 이미 학부모에게 발송 — 최대 오발송 벡터)
 * ④ isClassnoteAllowed(too_old: 전 달 1일 이후) ⑤ isClassnoteSubjectEnabled(과목 opt-in — injaewon은
 * math만) ⑥ classnoteSendEnabled(발송 스위치 OFF면 아예 감지 안 함 — 보낼 수 없는데 재촉 금지).
 * 창은 어제까지 최근 7일(오늘 작성분은 아직 발송 중일 수 있어 제외, 오래된 건 무한 잔소리 방지).
 *
 * 받는 사람 · 반복(2026-11-05 원장 *"… '깜빡한 보고서'가 있으면 최대 3일간 선생님에게 알려줄것."* · 적대 리뷰 C2·I1):
 * - 보고서 하나는 **딱 한 곳** — 작성 계정(재직) → 그 보고서 반(보강은 앵커 반)의 재직 담임 → 원장(`unsentRecipientOf`).
 *   학생의 다른 반 담임에게는 보내지 않는다.
 * - **직원 몫** = 하루 한 번, 처음 잡힌 날을 포함해 보고서당 최대 3번(bucket `remind:{KST 오늘}` · 횟수는 지난 기록으로 센다).
 * - **원장 1회분**(받을 직원이 없는 건) = 종전 그대로 보고서당 1회(bucket `"unsent"`). 콜드스타트 판정도 같은 event_type 하나.
 * 이벤트는 한 번의 upsert로 기록한다(한쪽만 기록되고 알림이 빠지는 틈을 만들지 않게).
 * 내보내는 까닭 = 가짜 DB로 통째 도는 시험(`unsent-detect.test.ts`) — 운영 호출처는 `detectAndNotifyEvents` 하나다.
 */
export async function detectUnsentReports(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  const settings = await getTenantSettingsByTenantId(tenantId);
  // ⑥ 발송 자체가 꺼진 테넌트는 감지도 하지 않는다(시드도 남기지 않음 — 켜는 날 콜드스타트로 시작).
  if (!classnoteSendOn(settings)) return 0;

  const dayMs = 86_400_000;
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const windowStart = new Date(todayMs - UNSENT_REPORT_WINDOW_DAYS * dayMs).toISOString().slice(0, 10);
  const yesterday = new Date(todayMs - dayMs).toISOString().slice(0, 10);

  const { data, error } = await admin
    .from("lesson_reports")
    .select("id, student_id, report_date, subject, class_id, makeup_class_id, makeup, notes, created_at, created_by, student:student_id ( name )")
    .eq("tenant_id", tenantId) // admin RLS 우회 — 테넌트 필터가 유일한 격리선
    .is("classnote_status", null)
    .is("revoked_at", null)
    .or("source.is.null,source.neq.edutrix_import")
    .gte("report_date", windowStart)
    .lte("report_date", yesterday)
    // 최근 순 — 상한 500에 잘리는 쪽이 가장 오래된(곧 기한이 끝나는) 건이 되게(종전 오래된 순은 최근분이 잘렸다, 리뷰 M1).
    .order("report_date", { ascending: false })
    .limit(500);
  if (error) throw new Error(`detectUnsentReports query: ${error.message}`);

  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 🔴 게이트는 발송 콘솔·발송 큐 카드와 **같은 한 벌**([`unsent-sendable.ts`]) — 갈라지면 "보낼 수 없는 건"을
  //    재촉하거나(거짓 알림) 카드 숫자와 알림 숫자가 어긋난다([[#77]]).
  //    기한·과목 opt-in·'수업보고서 미발송' 반(0174a)·**멘트 유무**·그날 결석이 한 함수 안에 있다.
  //    ⚠️ 멘트 게이트는 2026-09-09에 여기로 들어왔다 — 종전엔 알림만 이 항목이 없어, 발송 콘솔이 거절하는
  //       빈 멘트 보고서까지 재촉하고 있었다.
  //    ⚠️ class_id가 NULL인 건(보강·이관분)은 반 판정이 불가능하니 그대로 둔다 — 모르면 빼지 않는다.
  const rows: (UnsentRow & { studentName: string; createdDate: string | null } & UnsentRouting)[] = (data ?? []).map((row) => {
    const student = (Array.isArray(row.student) ? row.student[0] : row.student) as { name?: string } | undefined;
    const classId = (row.class_id as string | null) ?? null;
    const makeup = row.makeup as boolean | null;
    return {
      id: row.id as string,
      studentId: row.student_id as string,
      reportDate: (row.report_date as string).slice(0, 10),
      subject: row.subject as string | null,
      classId,
      makeup,
      ment: (row.notes as string | null) ?? null,
      studentName: student?.name ?? "(학생)",
      // 작성일 = 첫 저장 시각의 **KST** 날짜(원스크린 저장은 unit_key upsert라 다시 저장해도 created_at은 그대로).
      // ⚠️ `.slice(0, 10)` 금지 — UTC 날짜라 00:00~08:59 KST 저장분이 하루 앞당겨진다.
      createdDate: kstDateOf(row.created_at),
      // 받는 사람 재료 — 작성 계정(0172a 트리거가 갱신에도 보존) · 반(보강은 class_id가 비고 앵커가 makeup_class_id).
      createdBy: (row.created_by as string | null) ?? null,
      anchorClassId: makeup ? ((row.makeup_class_id as string | null) ?? classId) : classId,
    };
  });
  // 🔴 테스트 학생은 재촉하지 않는다(원장 2026-09-13) — **후보 선정 단계**에서 뺀다. 알림 본문이 묶음이라
  //    (`구한결 외 10명 …`) 나중에 항목째 버리면 같은 본문의 실학생 건까지 함께 사라진다.
  //    ⚠️ 게이트 함수(`unsent-sendable.ts`)가 아니라 **여기서** 뺀다 — 그 함수는 발송 큐 카드와 공유라,
  //       거기 넣으면 원장이 "빼지 않기로 한" 큐 카드 수까지 같이 바뀐다.
  // ⚠️ 두 조회는 서로 독립이라 병렬(B4).
  const [testStudentIds, optoutClassIds] = await Promise.all([
    getTestStudentIds(admin, tenantId),
    fetchReportOptoutClassIds(admin, tenantId),
  ]);
  const sendableRows = rows.filter((row) => !testStudentIds.has(row.studentId));
  // 결석 게이트(#77): 원스크린 save는 결석도 저장하는 게 정책이라, 결석이라 **보낼 수 없는** 저장분을
  // '미발송'으로 재촉하면 거짓 알림이 된다. 보강 보고서(makeup)는 게이트 제외(발송 콘솔과 동일).
  // 반 단위 판정(0134a). 조회 실패는 throw → 외곽 try/catch가 기록(그날 재촉 생략 = fail-closed).
  const keyOf = (row: UnsentRow) => ({
    studentId: row.studentId,
    reportDate: row.reportDate,
    subject: row.subject,
    classId: row.classId,
  });
  const absenceBlockedKeys = await getAbsenceBlockedKeys(
    admin,
    tenantId,
    sendableRows.filter((row) => !row.makeup).map(keyOf),
  );
  const sendable = filterUnsentSendable(sendableRows, {
    today,
    classnoteSubjects: settings.report.classnoteSubjects,
    optoutClassIds,
    absenceBlockedKeys,
    absenceKeyOf: (row) => absenceKeyOf(keyOf(row)),
  });
  // 할 일(0379a '미발송 수업 보고서') — 알림 중복 막기(dedup)·콜드스타트와 따로, 지금 보낼 수 있는 미발송마다 연다.
  // 같은 게이트(sendable) 한 벌이라 할 일과 발송 콘솔이 어긋나지 않는다. 읽었는데 빠진 건은 DB가 닫는다.
  // 닫는 판정은 이번에 실제로 읽은 보고서만(조회 상한 500에 밀린 보고서의 할 일은 건드리지 않는다).
  const taskByReport = await syncUnsentTasks(admin, tenantId, sendable.map((row) => row.id), rows.map((row) => row.id));
  // 일요일(KST)엔 알림을 기록·발송하지 않는다(원장 2026-11-06 B) — 할 일 동기화(위)는 그대로 돌고, 월요일부터 이어서 센다.
  if (isUnsentQuietDay(today)) return 0;
  const inputs = sendable.map((row) => ({
    reportId: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    subjectLabel: (row.subject ? subjects.labelOf(row.subject) : null) ?? row.subject ?? "수업",
    reportDate: row.reportDate,
    createdDate: row.createdDate,
    // 발송 마지막 날 — 7일 규칙 한 곳(classnote-guard)에서 받는다(본문 '…까지만 보낼 수 있습니다').
    sendDeadline: classnoteRetryDeadline(row.reportDate, today).lastDate || null,
    createdBy: row.createdBy,
    anchorClassId: row.anchorClassId,
  }));
  // 받는 사람 재료(작성 계정 재직 여부 · 반 → 재직 담임)와 지난 알림 기록 — 서로 독립이라 병렬(B4).
  const [activeStaff, classTeacher, reportPrior, draftPrior] = await Promise.all([
    activeUserIds(admin, tenantId, inputs.flatMap((input) => (input.createdBy ? [input.createdBy] : []))),
    activeClassTeachers(admin, tenantId, inputs.flatMap((input) => (input.anchorClassId ? [input.anchorClassId] : []))),
    unsentPriorEvents(admin, tenantId, inputs.map((input) => input.reportId)),
    recentDraftEvents(admin, tenantId, today),
  ]);
  // 두 단계 합쳐 최대 3번(원장 2026-11-06) — 입력 단계(저장 안 된 수업 보고서)에서 직원에게 울린 횟수를 같은 학생·날짜·과목
  // 보고서의 이력에 더한다(오늘 입력 단계로 울렸으면 오늘은 이 단계도 울리지 않는다).
  const prior = [
    ...reportPrior,
    ...draftPriorForReports(draftPrior, sendable.map((row) => ({ reportId: row.id, studentId: row.studentId, reportDate: row.reportDate, subject: row.subject }))),
  ];
  const candidates = planUnsentAlerts({ rows: inputs, todayKst: today, activeStaff, classTeacher, prior });
  const cold = await isColdStart(admin, tenantId, "unsent_report");
  // 한 번의 upsert로 원장 1회분·직원 몫을 함께 기록(원자적). 같은 날 다시 돌면 오늘 bucket이 이미 있어 새로 들어가지 않는다.
  const recorded = (await recordNew(admin, tenantId, "unsent_report", candidates, cold)) as UnsentReportEvent[];
  if (cold || recorded.length === 0) return 0;
  const { master, byRecipient } = splitRecordedUnsent(recorded, today);

  const items: NotifyInput[] = [];
  // 원장 = 받을 직원(작성자·반 담임)이 없는 건만, 보고서당 한 번(원장 2026-10-29 '나와 관련 있는 알림만').
  const masterBody = unsentReportDigestBody(master);
  if (masterBody) {
    for (const recipientId of await activeMasterIds(admin, tenantId)) {
      items.push({
        tenantId,
        recipientId,
        type: "unsent_report",
        title: "미발송 수업 보고서(담당 강사 없음)",
        body: masterBody,
        // ⚠️ 발송 콘솔은 '목록'(tab=list, ReportList가 sendClassnoteForUnsent 호출)이다 —
        // tab=writing은 '작성률' 표라 미발송 목록도 발송 버튼도 없다(적대 리뷰 확정 결함, 2026-07-17).
        // 목록에서 **그 건들만** 걸러 보여 준다(`status=__unsent__`) — 종전엔 이번 달 전건이 떠서
        // 원장이 "알림엔 미발송이 많은데 들어가면 없다"고 물었다(2026-09-09 — 알림이 옳았다).
        link: `/lesson-reports?tab=list&status=${encodeURIComponent(UNSENT_FILTER)}`,
        actorId: null,
        taskIds: master.flatMap((event) => taskByReport.get(event.subjectKey) ?? []),
      });
    }
  }
  // 직원 몫 = 받는 사람(작성자 또는 반 담임)마다 묶음 한 건. 마지막 날 마감 시각 = 발송 시간창 끝(워커가 다시 본다).
  const windowEnd = unsentSendWindowEnd(settings.report.classnoteSendWindowStart ?? "", settings.report.classnoteSendWindowEnd ?? "");
  for (const [recipientId, events] of byRecipient) {
    const body = unsentTeacherDigestBody(events, today, windowEnd);
    if (!body) continue;
    items.push({
      tenantId,
      recipientId,
      type: "unsent_report",
      title: "미발송 보고서 확인",
      body,
      link: "/onescreen", // 강사는 lesson_reports 권한이 없다 — 원스크린에서 발송
      actorId: null,
      // 할 일 연결은 받는 사람이 그 할 일의 담당(report_assignees — 반 담임 우선)이 아니어도 잇는다: 벨 칩은 '내가 맡은
      // 할 일'만 보이고(taskBadgesFor), 보고서를 보내 할 일이 닫히면 이 알림도 읽음이 된다(0447a 트리거). 담당 규칙은 그대로.
      taskIds: events.flatMap((event) => taskByReport.get(event.subjectKey) ?? []),
    });
  }
  await notifyUsers(items);
  // 관측용 = 이번에 새로 기록된 보고서 수(원장 1회분과 직원 몫을 보고서 단위로 — 한 보고서를 두 번 세지 않게).
  return new Set(recorded.map((event) => event.subjectKey)).size;
}

/**
 * 최근 10일 '저장 안 된 수업 보고서'(`unsent_draft`) 기록 — 입력 단계 횟수·오늘 울림 판정과, 저장 뒤 미발송 재알림 횟수에 더하는 데
 * 쓴다. 입력 단계 알림은 수업 이틀째~기한(D+2~D+6)에만 생기므로 지금 판정에 필요한 기록은 모두 이 창 안에 있다(최대 수백 줄 — 페이지로, B2).
 */
async function recentDraftEvents(admin: SupabaseClient, tenantId: string, today: string): Promise<UnsentPriorEvent[]> {
  const since = new Date(`${addDays(today, -10)}T00:00:00+09:00`).toISOString();
  const rows = await fetchAllPaged<{ subject_key: string; bucket: string; seeded: boolean | null; created_at: string | null }>((from, to) =>
    admin
      .from("notification_events")
      .select("subject_key, bucket, seeded, created_at")
      .eq("tenant_id", tenantId) // admin RLS 우회 — 테넌트 필터가 유일한 격리선
      .eq("event_type", "unsent_draft")
      .gte("created_at", since)
      .order("id")
      .range(from, to),
  );
  return rows.map((row) => ({ subjectKey: row.subject_key, bucket: row.bucket, seeded: row.seeded === true, createdDate: kstDateOf(row.created_at) }));
}

/**
 * 앱이 그 칸에 미리 채웠을 값을 감지 때 다시 계산한다(원장 2026-11-06 A — 세션엔 자동 값 표식이 없다). roster.ts ③④와 같은 원천:
 *  · ECS 시트 초안 — `class_sheet_plan_lines`(그 반·그날) → `buildSheetDraft`(영역 라벨은 roster와 같은 `resolveSkillAreas`): 진도·오늘 과제·교재
 *  · 직전 보고서 교재 — 그 학생의 같은 과목(과목 없는 옛 보고서 포함) 보고서 중 수업일 전 1년 · 끝 쪽수 뗀 것(`stripTextbookPages`)과 원문
 *    (roster가 어느 보고서를 '직전'으로 골랐을지 다시 짜지 않고 모두 후보로 둔다 — roster RPC `onescreen_prior_reports`(0135a·0152a)가
 *    고르는 '반·과목별 수업일 전 최신 1건'은 늘 이 후보 안에 든다, 1년 안이면).
 *    1년인 까닭(C1 r2 경미 2): RPC는 기간 제한이 없지만 여기서 같은 걸 하려면 학생마다 전 이력을 매일 읽어야 한다(이력이 쌓일수록
 *    끝없이 는다 — 침산 2026-11-06 실측 28일 입력 학생 240명 보고서 17,741행 · 학생당 1년 약 74행). 1년이면 읽는 양에 상한이 있고,
 *    침산 자료는 2025-11-03부터라 지금은 '제한 없음'과 같은 행을 읽는다. 1년 넘게 그 반·과목 보고서가 없던 학생의 이어 채운 교재만
 *    '직접 쓴 것'으로 잘못 셀 수 있다(드묾 — 120일 창일 땐 4주 교재 칸 1,908개 중 11개가 창 밖이었고, 1년 창이면 지금 0개).
 *  · 교재요청서 교재 — `textbook_orders` 그 학생 주문 전부 · **수학 줄만**(roster 규칙 — 그 표엔 과목 칸이 없다)
 *  · 일일·확인 점수 — 오늘 수학 채점 결과(`todays_math_test_results`, roster `loadTodaysMathFill`과 같은 표·같은 거름):
 *    지점 라이선스(`todays_math`)가 있으면 학원 설정 '시험 결과 채우기'(`report.todaysMathTestFill`)와 상관없이 읽는다 — 설정을 켰다
 *    끈 뒤에도 그동안 원스크린이 채워 세션에 남긴 점수를 자동 값으로 알아야 한다(모르면 '직접 쓴 흔적'으로 세어 거짓 알림이 최대 3번 ·
 *    C1 r3 재리뷰). 읽기만이라 설정이 꺼져도 해가 없다. 라이선스가 없는 학원은 조회 0번(일요일도 0번).
 *    침산 2026-11-06: 라이선스 켜짐 · 채우기 꺼짐 · 결과 표 0행 → 평일엔 조회한다(비용 작음). 짝짓기는 `todaysMathAutoScores`.
 * 넓게 잡는다 = 자동 값을 놓쳐 '직접 쓴 것'으로 잘못 세는 쪽(거짓 알림)보다 덜 우는 쪽. ⚠️ 시트 계획이 세션 저장 뒤 바뀌었으면 옛 자동 값은 알 수 없다.
 */
async function draftAutoValues(
  admin: SupabaseClient,
  tenantId: string,
  settings: Awaited<ReturnType<typeof getTenantSettingsByTenantId>>,
  scope: { classIds: readonly string[]; students: readonly string[]; from: string; to: string },
): Promise<(unit: DraftUnit) => DraftAutoValues> {
  type PlanRow = { class_id: string; plan_date: string; slot_start: string; line_no: number; skill_area: string | null; textbook: string | null; page_range: string | null; progress: string | null; homework: string | null };
  type MathRow = TodaysMathFillRow & { test_date: string };
  const [planRows, priorRows, orderRows, mathRows] = await Promise.all([
    scope.classIds.length
      ? fetchAllPagedInChunks<PlanRow>([...scope.classIds], (chunk, from, to) =>
          admin
            .from("class_sheet_plan_lines")
            .select("class_id, plan_date, slot_start, line_no, skill_area, textbook, page_range, progress, homework")
            .eq("tenant_id", tenantId) // admin — 이 표는 RLS 정책이 없어 사용자 클라이언트로는 0행(roster와 같다)
            .in("class_id", chunk)
            .gte("plan_date", scope.from)
            .lte("plan_date", scope.to)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([] as PlanRow[]),
    fetchAllPagedInChunks<{ student_id: string; report_date: string; subject: string | null; textbook: string | null }>([...scope.students], (chunk, from, to) =>
      admin
        .from("lesson_reports")
        .select("student_id, report_date, subject, textbook")
        .eq("tenant_id", tenantId)
        .in("student_id", chunk)
        .gte("report_date", addDays(scope.from, -365))
        .lte("report_date", scope.to)
        .order("id")
        .range(from, to),
    ),
    fetchAllPagedInChunks<{ student_id: string; book_name: string | null }>([...scope.students], (chunk, from, to) =>
      admin.from("textbook_orders").select("student_id, book_name").eq("tenant_id", tenantId).in("student_id", chunk).order("id").range(from, to),
    ),
    (async () => {
      if (!(await isFeatureOptedIn(tenantId, "todays_math"))) return [] as MathRow[];
      return fetchAllPagedInChunks<MathRow>([...scope.students], (chunk, from, to) =>
        admin
          .from("todays_math_test_results")
          .select("student_id, class_id, kind, question_count, absent, correct_count, taken_at, test_date")
          .eq("tenant_id", tenantId) // admin — 정책 없는 RLS(서버 전용) 표라 지점 id가 유일한 격리선(roster와 같다)
          .in("kind", ["daily", "review"])
          .in("student_id", chunk)
          .gte("test_date", scope.from)
          .lte("test_date", scope.to)
          // 이 표엔 id 칸이 없다 — 기본 키(tenant_id, source_test_id, student_id) 순으로 페이지를 넘긴다(결정적).
          .order("source_test_id")
          .order("student_id")
          .range(from, to),
      );
    })(),
  ]);
  const areaLabel = new Map(resolveSkillAreas(settings.operations.subjects.find((s) => s.key === "english")).map((a) => [a.key, a.label]));
  const linesBy = new Map<string, SheetPlanLine[]>();
  for (const r of planRows) {
    const k = `${r.class_id}|${r.plan_date.slice(0, 10)}`;
    (linesBy.get(k) ?? linesBy.set(k, []).get(k)!).push({
      slotStart: r.slot_start, lineNo: r.line_no, skillArea: r.skill_area, textbook: r.textbook, pageRange: r.page_range, progress: r.progress, homework: r.homework,
    });
  }
  const sheetBy = new Map([...linesBy].map(([k, lines]) => [k, buildSheetDraft(lines, (key) => areaLabel.get(key) ?? null)]));
  const priorBy = new Map<string, { date: string; subject: string | null; textbook: string }[]>();
  for (const r of priorRows) {
    if (!r.textbook?.trim()) continue;
    (priorBy.get(r.student_id) ?? priorBy.set(r.student_id, []).get(r.student_id)!).push({ date: r.report_date.slice(0, 10), subject: r.subject, textbook: r.textbook });
  }
  const ordersBy = new Map<string, Set<string>>();
  for (const r of orderRows) {
    if (!r.book_name?.trim()) continue;
    (ordersBy.get(r.student_id) ?? ordersBy.set(r.student_id, new Set()).get(r.student_id)!).add(r.book_name.trim());
  }
  const mathBy = new Map<string, MathRow[]>();
  for (const r of mathRows) {
    const k = `${r.student_id}|${r.test_date.slice(0, 10)}`;
    (mathBy.get(k) ?? mathBy.set(k, []).get(k)!).push(r);
  }
  const showTests = { daily: settings.report.showDailyTest, check: settings.report.showCheckTest };
  return (u) => {
    const sheet = u.classId ? sheetBy.get(`${u.classId}|${u.date}`) : undefined;
    const textbooks = new Set<string>();
    if (sheet?.textbook) textbooks.add(sheet.textbook.trim());
    for (const r of priorBy.get(u.studentId) ?? []) {
      if (r.date >= u.date || (r.subject && r.subject !== u.subject)) continue;
      textbooks.add(stripTextbookPages(r.textbook));
      textbooks.add(r.textbook.trim());
    }
    if (u.subject === "math") for (const book of ordersBy.get(u.studentId) ?? []) textbooks.add(book);
    const scores = todaysMathAutoScores(mathBy.get(`${u.studentId}|${u.date}`) ?? [], u, showTests);
    return { progress: sheet?.progress || null, homework: sheet?.homework || null, textbooks, dailyScores: scores.daily, checkScores: scores.check };
  };
}

/**
 * 저장 안 된 수업 보고서 감지 — 원스크린에 입력만 하고 보고서로 저장하지 않은 수업 → 입력한 선생님(원장 2026-11-06 결정: 권장안 ·
 * 밀린 건도 알림 = 콜드스타트 시드 없음 `seedsOnColdStart("unsent_draft") = false`).
 * 판정은 순수 함수 `eligibleUnsentDrafts`(events-core) 한 곳 — 기준(이틀째·기한·저장 짝·게이트·반 출결·평소 쓰는 반)은 그 주석.
 * 받는 사람(입력 계정 재직 → 그 반 재직 담임 → 원장 1회분)·하루 한 번·최대 3번은 미발송 재알림과 같은 함수를 쓴다(키만 입력 단위).
 * 할 일은 잇지 않는다(알림만 — 할 일 동기화는 보고서 id 기준이라 저장 전 입력엔 열 수 없다).
 * 내보내는 까닭 = 가짜 DB로 통째 도는 시험(`unsent-detect.test.ts`) — 운영 호출처는 `detectAndNotifyEvents` 하나다.
 */
export async function detectUnsentDrafts(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  const settings = await getTenantSettingsByTenantId(tenantId);
  // 발송이 꺼진 테넌트는 감지하지 않는다(보낼 수 없는데 재촉 금지 — 미발송과 같다).
  if (!classnoteSendOn(settings)) return 0;
  // 일요일(KST)엔 기록·발송하지 않는다(원장 2026-11-06 B) — 월요일부터 이어서 센다.
  if (isUnsentQuietDay(today)) return 0;
  const historyFrom = addDays(today, -UNSENT_DRAFT_HISTORY_DAYS);
  const yesterday = addDays(today, -1);

  // 최근 28일 세션·보고서·반 과목 — '평소 쓰는 반'과 저장 짝 판정 재료. 1,000행을 넘으니 페이지로(B2) · 서로 독립이라 병렬(B4).
  const [sessionRows, reportRows, classRows] = await Promise.all([
    fetchAllPaged<{ student_id: string; session_date: string; updated_by: string | null; subject_progress: unknown; updated_at: string | null }>((from, to) =>
      admin
        .from("onescreen_daily_sessions")
        .select("student_id, session_date, updated_by, subject_progress, updated_at")
        .eq("tenant_id", tenantId) // admin RLS 우회 — 테넌트 필터가 유일한 격리선
        .gte("session_date", historyFrom)
        .lte("session_date", yesterday)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ student_id: string; report_date: string; class_id: string | null; makeup: boolean | null; subject: string | null }>((from, to) =>
      admin
        .from("lesson_reports")
        .select("student_id, report_date, class_id, makeup, subject")
        .eq("tenant_id", tenantId)
        .gte("report_date", historyFrom)
        .lte("report_date", yesterday)
        .order("id")
        .range(from, to),
    ),
    fetchAllPaged<{ id: string; subject: string | null }>((from, to) =>
      admin.from("classes").select("id, subject").eq("tenant_id", tenantId).order("id").range(from, to),
    ),
  ]);
  const subjectByClass = new Map(classRows.map((c) => [c.id, c.subject]));
  const subjectOfClass = (classId: string) => subjectByClass.get(classId) ?? null;
  const units = unsentDraftUnits(
    sessionRows.map((s) => ({ studentId: s.student_id, date: s.session_date.slice(0, 10), updatedBy: s.updated_by, subjectProgress: s.subject_progress, updatedAt: s.updated_at })),
    subjectOfClass,
  );
  const reports = reportRows.map((r) => ({ studentId: r.student_id, date: r.report_date.slice(0, 10), classId: r.class_id, makeup: r.makeup, subject: r.subject }));
  const saved = unsentDraftSavedIndex(reports, subjectOfClass);
  const usualClasses = unsentDraftUsualClasses(units, reports);

  // 값싼 판정을 먼저(조회가 필요한 결석·반 출결은 남은 것만) — 결석·출결은 '아무것도 없음'으로 두고 한 번 거른다.
  const [testStudentIds, optoutClassIds] = await Promise.all([getTestStudentIds(admin, tenantId), fetchReportOptoutClassIds(admin, tenantId)]);
  const gateArgs = { todayKst: today, saved, testStudentIds, classnoteSubjects: settings.report.classnoteSubjects, optoutClassIds, usualClasses };
  const rough = eligibleUnsentDrafts({ ...gateArgs, units, absent: () => false, classAttendance: () => 1, direct: () => true });
  if (rough.length === 0) return 0;

  // 남은 단위만 조회 — 결석(반 단위 · 보강 제외) · 그 반 그날 출결 수 · 앱이 미리 채웠을 값(직접 쓴 흔적 판정 재료).
  const keyOf = (u: DraftUnit) => ({ studentId: u.studentId, reportDate: u.date, subject: u.subject, classId: u.classId });
  const regular = rough.filter((u) => !u.makeup && u.classId);
  const classIds = [...new Set(regular.map((u) => u.classId as string))];
  const dates = regular.map((u) => u.date).sort();
  const roughStudents = [...new Set(rough.map((u) => u.studentId))];
  const roughDates = rough.map((u) => u.date).sort();
  const [absenceBlockedKeys, attendanceRows, autoOf] = await Promise.all([
    getAbsenceBlockedKeys(admin, tenantId, regular.map(keyOf)),
    dates.length
      ? fetchAllPagedInChunks<{ class_id: string; session_date: string }>(classIds, (chunk, from, to) =>
          admin
            .from("attendance_records")
            .select("class_id, session_date")
            .eq("tenant_id", tenantId)
            .in("class_id", chunk)
            .gte("session_date", dates[0]!)
            .lte("session_date", dates[dates.length - 1]!)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([] as { class_id: string; session_date: string }[]),
    draftAutoValues(admin, tenantId, settings, { classIds, students: roughStudents, from: roughDates[0]!, to: roughDates[roughDates.length - 1]! }),
  ]);
  const attendanceByClassDay = new Map<string, number>();
  for (const a of attendanceRows) {
    const k = `${a.class_id}|${a.session_date.slice(0, 10)}`;
    attendanceByClassDay.set(k, (attendanceByClassDay.get(k) ?? 0) + 1);
  }
  const eligible = eligibleUnsentDrafts({
    ...gateArgs,
    units: rough,
    absent: (u) => absenceBlockedKeys.has(absenceKeyOf(keyOf(u))),
    classAttendance: (classId, date) => attendanceByClassDay.get(`${classId}|${date}`) ?? 0,
    direct: (u) => unsentDraftDirectInput(u.cell, autoOf(u)),
  });
  if (eligible.length === 0) return 0;

  // 이름 · 과목 라벨 · 받는 사람 재료 · 지난 기록 — 서로 독립이라 병렬(B4).
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const [students, activeStaff, classTeacher, prior] = await Promise.all([
    fetchInChunks<{ id: string; name: string | null }>([...new Set(eligible.map((u) => u.studentId))], (chunk) =>
      admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    ),
    activeUserIds(admin, tenantId, eligible.flatMap((u) => (u.updatedBy ? [u.updatedBy] : []))),
    activeClassTeachers(admin, tenantId, eligible.flatMap((u) => (u.anchorClassId ? [u.anchorClassId] : []))),
    recentDraftEvents(admin, tenantId, today),
  ]);
  const nameOf = new Map(students.map((s) => [s.id, s.name ?? "(학생)"]));
  // 같은 입력 키를 여러 입력자가 가지면 하나만(재직 담임 → 그 밖의 재직 입력자 → 퇴사·알 수 없음 · 같으면 늦게 저장한 사람).
  const chosen = pickDraftUnitPerKey(eligible, classTeacher, activeStaff);
  const inputByKey = new Map(chosen.map((u) => [u.key, u.updatedBy]));
  const candidates = planUnsentAlerts({
    rows: chosen.map((u) => ({
      reportId: u.key,
      studentId: u.studentId,
      studentName: nameOf.get(u.studentId) ?? "(학생)",
      subjectLabel: (u.subject ? subjects.labelOf(u.subject) : null) ?? u.subject ?? "수업",
      reportDate: u.date,
      createdDate: null, // 저장 전 — 작성 당일 판정 없음(이틀째부터만 후보다)
      sendDeadline: classnoteRetryDeadline(u.date, today).lastDate || null,
      createdBy: u.updatedBy, // 받는 사람 ① = 입력한 계정
      anchorClassId: u.anchorClassId,
    })),
    todayKst: today,
    activeStaff,
    classTeacher,
    prior,
  });
  const cold = await isColdStart(admin, tenantId, "unsent_draft"); // 시드하지 않는 종류 — 늘 false(밀린 건도 알림)
  const recorded = (await recordNew(admin, tenantId, "unsent_draft", candidates, cold)) as UnsentReportEvent[];
  if (cold || recorded.length === 0) return 0;
  const { master, byRecipient } = splitRecordedUnsent(recorded, today);

  const windowEnd = unsentSendWindowEnd(settings.report.classnoteSendWindowStart ?? "", settings.report.classnoteSendWindowEnd ?? "");
  const items: NotifyInput[] = [];
  // 원장 1회분 = 받을 직원이 없는 건(입력자도 퇴사) — 원장은 입력한 본인이 아니다.
  const masterBody = unsentDraftDigestBody(master, today, windowEnd, true);
  if (masterBody) {
    for (const recipientId of await activeMasterIds(admin, tenantId)) {
      items.push({
        tenantId,
        recipientId,
        type: "unsent_report",
        title: "저장 안 된 수업 보고서(담당 강사 없음)",
        body: masterBody,
        // 저장 전 입력은 보고서 목록에 없다 — 반별 작성 현황('작성률' 표)이 그 반의 빈 보고서를 보여 준다.
        link: "/lesson-reports?tab=writing",
        actorId: null,
      });
    }
  }
  for (const [recipientId, events] of byRecipient) {
    // 본인이 입력한 것 / 다른 선생님(퇴사한 입력자)이 입력한 것을 따로 — 세션 초안은 강사별이라 남의 입력은 내 원스크린에 안 보인다.
    // 링크는 둘 다 그 수업일의 원스크린: 본인 것은 입력해 둔 칸이, 남의 것은 그 날짜 내 반 줄이 떠 거기서 보고서를 쓴다.
    const own = events.filter((event) => inputByKey.get(event.subjectKey) === recipientId);
    const others = events.filter((event) => inputByKey.get(event.subjectKey) !== recipientId);
    for (const [group, byOthers] of [[own, false], [others, true]] as const) {
      const body = unsentDraftDigestBody(group, today, windowEnd, byOthers);
      if (!body) continue;
      items.push({
        tenantId,
        recipientId,
        type: "unsent_report",
        title: "저장 안 된 수업 보고서",
        body,
        link: unsentDraftLink(group),
        actorId: null,
      });
    }
  }
  await notifyUsers(items);
  return new Set(recorded.map((event) => event.subjectKey)).size;
}

/**
 * 발송 실패 보고서의 **재발송 마지막 날** 감지 → 담당 강사 건별 + master 집계.
 *
 * 🔴 실패했다는 사실은 여기서 알리지 않는다 — 0143a DB 트리거와 유실 보정 스윕(failed-notify-sweep.ts)이
 *    이미 담당한다. 같은 사실을 두 경로가 울리면 경보 피로만 는다. 여기가 메우는 건 **"언제까지"**다:
 *    2026-08-11 실측으로 실패 16건 중 11건이 손 못 댄 채 기한을 넘겨 학부모에게 영영 못 나갔다(#105).
 *
 * **게이트는 재발송(retryClassnote)과 동일해야 한다** — 아니면 "보낼 수 없는 건"을 재촉하는 거짓 알림(#77):
 * ① classnote_status='failed' ② revoked 제외 ③ edutrix_import 제외 ④ 빈 멘트 제외 ⑤ isClassnoteAllowed
 * ⑥ 과목 opt-in ⑦ 발송 스위치 OFF면 감지 자체를 안 함 ⑧ 결석(그날 결석이면 재발송도 막힌다).
 */
async function detectSendDeadline(admin: SupabaseClient, tenantId: string): Promise<number> {
  const today = kstToday();
  const settings = await getTenantSettingsByTenantId(tenantId);
  // ⑦ 발송이 꺼진 테넌트는 시드도 남기지 않는다(켜는 날 콜드스타트로 시작).
  if (!classnoteSendOn(settings)) return 0;

  // ⚠️ 두 조회는 서로 독립이라 병렬(B4).
  const [{ data, error }, testStudentIds] = await Promise.all([
    admin
      .from("lesson_reports")
      .select("id, student_id, report_date, subject, class_id, makeup, notes, student:student_id ( name )")
      .eq("tenant_id", tenantId) // admin RLS 우회 — 테넌트 필터가 유일한 격리선
      .eq("classnote_status", "failed")
      .is("revoked_at", null)
      .or("source.is.null,source.neq.edutrix_import")
      .gte("report_date", classnoteMinDate(today)) // ⑤ 아직 손 쓸 수 있는 것만
      .order("report_date", { ascending: true })
      .limit(200),
    getTestStudentIds(admin, tenantId),
  ]);
  if (error) throw new Error(`detectSendDeadline query: ${error.message}`);

  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gated = (data ?? []).filter(
    (row) =>
      // 🔴 ⑨ 테스트 학생은 재촉하지 않는다(원장 2026-09-13 *"테스트 계정 알림 전부 off"*).
      //    이 경로는 원장이 지목한 '실제로 울린 4경로' **밖**이었지만, 테스트 학생('학원이')은 학부모
      //    연결이 없어 발송이 **항상 실패**한다 = `failed` 행이 상시 존재한다. 그래서 이 재발송 기한
      //    알림은 그 학생으로 반드시 울린다(적대 리뷰가 확인) — 지시의 취지대로 여기서도 뺀다.
      !testStudentIds.has(row.student_id as string) &&
      !!((row.notes as string | null) ?? "").trim() && // ④ 빈 멘트 절대 가드(retryClassnote와 동일)
      isClassnoteAllowed(row.report_date as string, today) &&
      isClassnoteSubjectEnabled(row.subject as string | null, settings.report.classnoteSubjects),
  );
  // ⑧ 결석 게이트 — 반 단위 판정(0134a)까지 재발송 경로와 같은 규약. 보강은 제외(발송 콘솔과 동일).
  const gateKeyOf = (row: (typeof gated)[number]) => ({
    studentId: row.student_id as string,
    reportDate: (row.report_date as string).slice(0, 10),
    subject: row.subject as string | null,
    classId: (row.class_id as string | null) ?? null,
  });
  const absentBlocked = await getAbsenceBlockedKeys(
    admin,
    tenantId,
    gated.filter((row) => !row.makeup).map(gateKeyOf),
  );
  const candidates = buildSendDeadlineEvents(
    gated
      .filter((row) => row.makeup || !absentBlocked.has(absenceKeyOf(gateKeyOf(row))))
      .map((row) => {
        const student = (Array.isArray(row.student) ? row.student[0] : row.student) as { name?: string } | undefined;
        const subject = row.subject as string | null;
        const reportDate = (row.report_date as string).slice(0, 10);
        return {
          reportId: row.id as string,
          studentId: row.student_id as string,
          studentName: student?.name ?? "(학생)",
          subjectLabel: (subject ? subjects.labelOf(subject) : null) ?? subject ?? "수업",
          reportDate,
          daysLeft: classnoteRetryDeadline(reportDate, today).daysLeft,
        };
      }),
  );
  const cold = await isColdStart(admin, tenantId, "send_deadline");
  const fresh = (await recordNew(admin, tenantId, "send_deadline", candidates, cold)) as SendDeadlineEvent[];
  if (cold || fresh.length === 0) return 0;

  const items: NotifyInput[] = [];
  // 타입은 기존 report_send_failed를 그대로 쓴다 — 중요도(important.ts)·배지가 이미 배선돼 있고,
  // 강사에겐 결국 같은 사건이다(새 타입을 만들면 두 줄기가 각자 배선을 요구한다).
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(fresh.map((event) => event.studentId))],
    today,
  );
  // 원장 = 그 보고서 반에 재직 담임이 없는 건만(원장 2026-10-29 '나와 관련 있는 알림만') — 미발송과 같은 판정.
  const classOfFailed = new Map(gated.map((row) => [row.id as string, (row.class_id as string | null) ?? null]));
  const failedClassTeacher = await activeClassTeachers(admin, tenantId, [...classOfFailed.values()].filter((id): id is string => !!id));
  const masterBody = sendDeadlineDigestBody(fresh.filter((event) => {
    const classId = classOfFailed.get(event.subjectKey);
    return !classId || !failedClassTeacher.has(classId);
  }));
  if (masterBody) {
    for (const recipientId of await activeMasterIds(admin, tenantId)) {
      items.push({
        tenantId,
        recipientId,
        type: "report_send_failed",
        title: "오늘까지만 재발송 가능(담당 강사 없음)",
        body: masterBody,
        link: "/lesson-reports?tab=list", // 재발송 버튼이 있는 유일한 자리
        actorId: null,
      });
    }
  }
  // 담당 강사 = 자기 학생 건만. ⚠️ subjectKey가 보고서 id라 studentIdOf 추출자 필수(안 넘기면 0건).
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(fresh, studentTeachers, (e) => e.studentId)) {
    for (const event of teacherEvents) {
      items.push({
        tenantId,
        recipientId: teacherId,
        type: "report_send_failed",
        title: "오늘까지만 재발송 가능",
        body: sendDeadlineBody(event),
        link: "/onescreen", // 강사는 lesson_reports 권한이 없다 — 원스크린에서 재발송
        actorId: null,
      });
    }
  }
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 테넌트 1건의 이벤트 감지·발송. cron이 브리핑 생성과 **독립된 try/catch**로 호출한다
 * (브리핑 실패해도 감지는 돌아야 함). 반환은 관측용 신규 이벤트 수(결석/후속조치/성적/미수).
 */
export async function detectAndNotifyEvents(
  tenantId: string,
): Promise<{
  absence: number;
  followup: number;
  enrollmentFollowup: number;
  gradeDrop: number;
  outstanding: number;
  unsentReport: number;
  unsentDraft: number;
  progressAnomaly: number;
  sendDeadline: number;
}> {
  const admin = createAdminClient();
  let absence = 0;
  let followup = 0;
  let enrollmentFollowup = 0;
  let gradeDrop = 0;
  let outstanding = 0;
  let unsentReport = 0;
  let unsentDraft = 0;
  let progressAnomaly = 0;
  let sendDeadline = 0;
  try {
    absence = await detectAbsence(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.absence", tenantId });
  }
  try {
    followup = await detectFollowup(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.followup", tenantId });
  }
  try {
    enrollmentFollowup = await detectEnrollmentFollowup(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.enrollmentFollowup", tenantId });
  }
  try {
    gradeDrop = await detectGradeDrop(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.gradeDrop", tenantId });
  }
  try {
    outstanding = await detectOutstanding(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.outstanding", tenantId });
  }
  try {
    unsentReport = await detectUnsentReports(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.unsentReport", tenantId });
  }
  try {
    unsentDraft = await detectUnsentDrafts(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.unsentDraft", tenantId });
  }
  try {
    progressAnomaly = await detectProgressAnomaly(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.progressAnomaly", tenantId });
  }
  try {
    sendDeadline = await detectSendDeadline(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.sendDeadline", tenantId });
  }
  return { absence, followup, enrollmentFollowup, gradeDrop, outstanding, unsentReport, unsentDraft, progressAnomaly, sendDeadline };
}
