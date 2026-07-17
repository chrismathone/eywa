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
import { kstToday } from "@/lib/date-kst";
import { followUpUrgency } from "@/features/consultations/follow-up-urgency";
import { getAbsenceRiskStudents } from "@/features/dashboard/server/queries";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { notifyUsers, type NotifyInput } from "./notify";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import {
  absenceDigestBody,
  buildAbsenceEvents,
  buildFollowupEvents,
  buildGradeDropEvents,
  buildOutstandingEvents,
  followupBody,
  weekKey,
  gradeDropDigestBody,
  groupEventsByTeacher,
  outstandingDigestBody,
  type AbsenceEvent,
  type FollowupEvent,
  type GradeDropEvent,
  type GradeRow,
  type OutstandingEvent,
} from "../events-core";

type EventType = "absence_alert" | "followup_due" | "grade_drop" | "outstanding_alert";
type EventRow = { tenant_id: string; event_type: EventType; subject_key: string; bucket: string; seeded: boolean };
/** admin client(RLS 우회)를 쿠키-클라 시그니처 db 주입에 넘길 때의 캐스트 별칭(briefing.ts 선례). */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** (tenant, event_type)에 기록된 이벤트가 하나도 없으면 콜드스타트(첫 실행). */
async function isColdStart(admin: SupabaseClient, tenantId: string, eventType: EventType): Promise<boolean> {
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

  // 반 → 담당 강사(본 테넌트·운영 중). teacher_id null(미지정)·타 테넌트·폐지 반은 제외.
  const classes = await fetchInChunks<{ id: string; teacher_id: string | null; tenant_id: string; is_active: boolean }>(
    classIds,
    (chunk) => admin.from("classes").select("id, teacher_id, tenant_id, is_active").in("id", chunk),
  );
  const teacherByClass = new Map<string, string>();
  const teacherIds = new Set<string>();
  for (const klass of classes) {
    if (klass.tenant_id !== tenantId || !klass.is_active || !klass.teacher_id) continue;
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
  const masterBody = absenceDigestBody(freshEvents);
  if (!masterBody) return 0;

  const items: NotifyInput[] = [];
  // ① master 전원 = 신규 이벤트 전체 집계 1건(원장 결정 '운영 벨=master').
  const masters = await activeMasterIds(admin, tenantId);
  for (const recipientId of masters) {
    items.push({
      tenantId,
      recipientId,
      type: "absence_alert",
      title: "반복 결석 위험 학생",
      body: masterBody,
      link: "/retention",
      actorId: null,
    });
  }
  // ② v2 — 담당 강사 = 자기 학생 신규 이벤트만 집계 1건(스코프 격리, 활성 강사만).
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(freshEvents.map((event) => event.subjectKey))],
    kstToday(),
  );
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(freshEvents, studentTeachers)) {
    const body = absenceDigestBody(teacherEvents);
    if (!body) continue;
    items.push({
      tenantId,
      recipientId: teacherId,
      type: "absence_alert",
      title: "담당 학생 반복 결석 위험",
      body,
      link: "/retention",
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
  const { data, error } = await admin
    .from("student_consultations")
    .select("id, follow_up_date, counselor_id, student:student_id ( name )")
    .eq("tenant_id", tenantId)
    .eq("follow_up_done", false)
    .not("follow_up_date", "is", null)
    .lte("follow_up_date", today) // 오늘 이하 = today(due) 또는 overdue만(soon/later 제외)
    .order("follow_up_date", { ascending: true });
  if (error) throw new Error(`detectFollowup query: ${error.message}`);

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

  const masters = await activeMasterIds(admin, tenantId);
  const activeCounselors = await activeUserIds(
    admin,
    tenantId,
    fresh.map((event) => event.counselorId).filter((id): id is string => Boolean(id)),
  );
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

  const { operations } = await getTenantSettingsByTenantId(tenantId);
  const subjects = buildSubjectMaps(operations.subjects);
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
  const masterBody = gradeDropDigestBody(fresh);
  const masters = await activeMasterIds(admin, tenantId);
  if (masterBody) {
    for (const recipientId of masters) {
      items.push({ tenantId, recipientId, type: "grade_drop", title: "성적 급락", body: masterBody, link: "/retention", actorId: null });
    }
  }
  // 담당 강사 = 자기 학생 성적 급락만(결석 v2와 동일 tenant 격리 역매핑 재사용).
  const studentTeachers = await getStudentActiveTeachers(
    admin,
    tenantId,
    [...new Set(fresh.map((event) => event.subjectKey))],
    today,
  );
  for (const [teacherId, teacherEvents] of groupEventsByTeacher(fresh, studentTeachers)) {
    const body = gradeDropDigestBody(teacherEvents);
    if (!body) continue;
    items.push({ tenantId, recipientId: teacherId, type: "grade_drop", title: "담당 학생 성적 급락", body, link: "/retention", actorId: null });
  }
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 미수 임계 감지(학생별 총 미수가 금액 tier 도달) → master + 회계(활성) 집계(콜드스타트면 시드만).
 * 미수는 학생별이 아니라 청구 도메인 전체라 담당 강사가 아닌 billing 역할(master/accountant)에게 집계 1건.
 */
async function detectOutstanding(admin: SupabaseClient, tenantId: string): Promise<number> {
  // p_tenant 변형(0121a) — 세션용 RPC는 service_role에서 auth_tenant_id() null → silent 0행.
  const { data, error } = await admin.rpc("dashboard_top_outstanding_admin", { p_limit: 500, p_tenant: tenantId });
  if (error) throw new Error(`detectOutstanding rpc: ${error.message}`);
  const candidates = buildOutstandingEvents(
    ((data ?? []) as Array<{ student_id: string; student_name: string; amount: number | string }>).map((row) => ({
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
  // billing 도메인 = master + 회계(accountant). 둘 다 활성만, 각자 전체 집계 1건.
  const recipients = await activeRoleIds(admin, tenantId, ["master", "accountant"]);
  const items: NotifyInput[] = recipients.map((recipientId) => ({
    tenantId,
    recipientId,
    type: "outstanding_alert",
    title: "미수금 주의 학생",
    body,
    link: "/billing",
    actorId: null,
  }));
  await notifyUsers(items);
  return fresh.length;
}

/**
 * 테넌트 1건의 이벤트 감지·발송. cron이 브리핑 생성과 **독립된 try/catch**로 호출한다
 * (브리핑 실패해도 감지는 돌아야 함). 반환은 관측용 신규 이벤트 수(결석/후속조치/성적/미수).
 */
export async function detectAndNotifyEvents(
  tenantId: string,
): Promise<{ absence: number; followup: number; gradeDrop: number; outstanding: number }> {
  const admin = createAdminClient();
  let absence = 0;
  let followup = 0;
  let gradeDrop = 0;
  let outstanding = 0;
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
    gradeDrop = await detectGradeDrop(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.gradeDrop", tenantId });
  }
  try {
    outstanding = await detectOutstanding(admin, tenantId);
  } catch (e) {
    reportError(e, { scope: "events.outstanding", tenantId });
  }
  return { absence, followup, gradeDrop, outstanding };
}
