import "server-only";
import { kstToday } from "@/lib/date-kst";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import type { TenantSettings } from "@/features/owner/settings-types";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { isReportTrackedSubject } from "@/features/dashboard/report-subjects";
import { isTestClass, type WorkEnrollment } from "@/features/dashboard/overview/work-targets";
import { buildDailyDuties, type DutyAttendance, type DutyClass, type DutyDraft, type DutyReport, type DutySchedule } from "../model/daily";
import { DUTY_KIND_KEYS, DUTY_KINDS } from "../kinds";
import { loadSubjectManagers } from "./managers";
import { loadOwnerAsOf } from "./owner-as-of";

const DAILY_KINDS = DUTY_KIND_KEYS.filter((k) => DUTY_KINDS[k].period === "daily");

/**
 * 하루치 의무 맞춤(지점 × 날짜) — 생성기가 분모를 만들고(`duty_upsert_items`), 명단에서 빠진 것은 void(`duty_void_stale`),
 * 원 표의 사실로 닫거나 되살린다(`duty_resolve_items`). 30분마다 돌아 같은 날을 여러 번 맞춰도 결과가 같다(멱등).
 * 🔴 관리 키(RLS 우회)라 모든 조회에 tenant_id(#104). 조회 실패는 throw — 일부만 읽고 void를 돌리면 멀쩡한 의무가 사라진다.
 * 반 범위·보고서 출처 판정은 운영실 `loadTeacherWork`와 같다(미발송 반 제외 · 작성 면제 강사 · 영어 = ClassNote 반 알림장).
 */
export async function syncDailyDuties(tenantId: string, date: string, settings: TenantSettings, opts: { /** 지난 달 다시 만들기 — 닫힌 행의 담당도 다시 적는다. */ reown?: boolean } = {}): Promise<{ drafts: number; inserted: number; done: number; voided: number }> {
  const admin = createAdminClient();
  // 지난 날은 **그날 기준**으로 맞춘다(원장 2026-11-11) — 그날의 담임 · 그날 재직 여부 · 그 뒤에 종강하거나 폐지한 반까지(폐지는 수강을 그날로 끝내므로 지난 날 명단은 그대로다 — 지금 운영 여부로 거르면 폐지만으로 지난 미처리가 사라진다). 오늘은 종전 그대로(지금 운영 중인 반 · 지금 담임).
  const past = date < kstToday();
  const asOf = await loadOwnerAsOf(tenantId);
  const classes = await fetchAllPaged<{ id: string; class_name: string; subject: string; english_track: string | null; teacher_id: string | null; report_optout: boolean | null; closed_at: string | null; is_active: boolean | null }>((from, to) => {
    const q = admin.from("classes").select("id,class_name,subject,english_track,teacher_id,report_optout,closed_at,is_active").eq("tenant_id", tenantId);
    return q.or(`closed_at.is.null,closed_at.gte.${date}`).order("id").range(from, to);
  });
  // 폐지한 반(운영 안 함 · 종강일 없음)은 **그날 장부에 이미 업무가 있을 때만** 넣는다 — 빼면 폐지만으로 그날의 미처리가 사라지고(오늘도 · 지난 날도),
  // 무조건 넣으면 폐지 뒤의 날에 없던 업무가 새로 생긴다(폐지는 시간표를 닫지 않는다 · 리뷰 2026-11-11).
  const archived = classes.filter((c) => !c.is_active && !c.closed_at).map((c) => c.id);
  const kept = new Set((await fetchAllPagedInChunks<{ class_id: string }>(archived, (chunk, from, to) =>
    admin.from("duty_items").select("class_id").eq("tenant_id", tenantId).eq("period", "daily").eq("cycle", date).in("class_id", chunk).order("id").range(from, to))).map((r) => r.class_id));
  const live = classes.filter((c) => !isTestClass(c.class_name) && (c.is_active || !!c.closed_at || kept.has(c.id))).map((c) => (past ? { ...c, teacher_id: asOf.teacherOf(c.id, c.teacher_id, date) } : c));
  const classIds = live.map((c) => c.id);
  if (!classIds.length) return { drafts: 0, inserted: 0, done: 0, voided: 0 };
  const classnoteOn = classnoteModuleOn(settings);
  const classnoteSending = classnoteSendOn(settings);
  const schedules = await fetchAllPagedInChunks<DutySchedule & { class_id: string }>(classIds, (chunk, from, to) =>
    admin.from("class_schedules").select("class_id,day_of_week,start_time,end_time,valid_from,valid_to,teacher_id,slot_teacher_label").eq("tenant_id", tenantId).in("class_id", chunk)
      .or(`valid_from.is.null,valid_from.lte.${date}`).or(`valid_to.is.null,valid_to.gte.${date}`).order("id").range(from, to));
  // 재직 여부는 담임뿐 아니라 교시 담당까지 본다(교시 담당이 퇴사자면 할 일이 아무에게도 안 간다 — 리뷰 2026-11-09).
  const teacherIds = [...new Set([...live.flatMap((c) => c.teacher_id ? [c.teacher_id] : []), ...schedules.flatMap((s) => s.teacher_id ? [s.teacher_id] : [])])];
  const [teachers, enrollments, attendance, reports, posts] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string; status: string | null }>(teacherIds, (chunk) =>
      admin.from("users").select("id,display_name,status").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<WorkEnrollment>(classIds, (chunk, from, to) =>
      admin.from("enrollments").select("class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk)
        .or(`start_date.is.null,start_date.lte.${date}`).or(`end_date.is.null,end_date.gte.${date}`).order("id").range(from, to)),
    fetchAllPagedInChunks<DutyAttendance>(classIds, (chunk, from, to) =>
      admin.from("attendance_records").select("id,student_id,class_id,session_date,slot_start,status,recorded_at").eq("tenant_id", tenantId)
        .in("class_id", chunk).eq("session_date", date).order("id").range(from, to)),
    fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string; report_date: string; covers_date: string | null; classnote_status: string | null; revoked_at: string | null; created_at: string | null; classnote_sent_at: string | null }>(classIds, (chunk, from, to) =>
      admin.from("lesson_reports").select("id,class_id,student_id,report_date,covers_date,classnote_status,revoked_at,created_at,classnote_sent_at,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk)
        .or(`report_date.eq.${date},covers_date.eq.${date}`).order("id").range(from, to)),
    classnoteOn ? fetchAllPaged<{ board_name: string; posted_on: string }>((from, to) =>
      admin.from("classnote_class_posts").select("board_name,posted_on").eq("tenant_id", tenantId).eq("posted_on", date).order("board_name").range(from, to)) : Promise.resolve([]),
  ]);
  const names = new Map(teachers.map((t) => [t.id, t.display_name]));
  // 퇴사자는 퇴사일 다음 날부터 담당에서 빠진다(그 전의 날은 그 사람 업무로 남는다).
  const inactive = new Set(teachers.filter((t) => t.status === "inactive" && asOf.retiredOn(t.id, date)).map((t) => t.id));
  const programs = programSubjectsOf(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])));
  const dutyClasses: DutyClass[] = live.map((c) => {
    const teacherName = c.teacher_id ? names.get(c.teacher_id) ?? "" : "";
    const english = subjectGroupOf(c.subject, programs) === "english";
    return { id: c.id, name: c.class_name, teacherId: c.teacher_id, teacherName, subject: c.subject, closedAt: c.closed_at,
      reportSource: c.report_optout === true || (teacherName && settings.report.writingExemptTeachers.includes(teacherName)) ? "none"
        : english ? (classnoteOn ? "classnote" : "none") : isReportTrackedSubject(c.subject, settings.report.classnoteSubjects) ? "lesson" : "none" };
  });
  const dutyReports: DutyReport[] = reports.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, date: r.report_date, coversDate: r.covers_date,
    status: r.classnote_status, videoHomework: false, recalled: !!r.revoked_at, createdAt: r.created_at, sentAt: r.classnote_sent_at }));
  const drafts = buildDailyDuties({ date, holidays: new Set(settings.operations.holidays.map((h) => h.date)), classes: dutyClasses, schedules, enrollments, attendance,
    reports: dutyReports, posts: posts.map((p) => ({ boardName: p.board_name, postedOn: p.posted_on })), classnoteSendOn: classnoteSending, inactiveTeacherIds: inactive });
  // 실제 발송을 끄면 같은 학생·담당·과목의 학생별 의무는 작성으로 바뀐다. 열린 발송 의무만 사유를 남겨 닫고 완료 이력은 보존한다.
  const writeKeys = [...new Set(drafts.filter((d) => d.kind === "report_write").map((d) => d.subjectKey))];
  for (let i = 0; i < writeKeys.length; i += 100) {
    const { error } = await admin.from("duty_items").update({ status: "void", void_reason: "send_disabled", task_id: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("kind", "report_send").eq("cycle", date).eq("status", "open").in("subject_key", writeKeys.slice(i, i + 100));
    if (error) throw new Error(`의무 장부 정리(발송 → 작성): ${error.message}`);
  }
  const written = await writeDrafts(tenantId, drafts, { rekey: true, cyclesOf: Object.fromEntries(DAILY_KINDS.map((k) => [k, [date]])), reown: opts.reown });
  // 보고서는 발송까지가 한 업무가 됐다(2026-11-10) — 같은 열쇠의 발송 의무가 선 날에 남은 옛 작성 의무(끝난 것 · 미이행 확정 포함)는 집계에서 뺀다.
  // (맞춤의 회차 정리는 열린 것만 지워서, 이미 끝난 작성 의무가 발송 의무와 함께 두 번 세졌다.)
  const sendKeys = [...new Set(drafts.filter((d) => d.kind === "report_send").map((d) => d.subjectKey))];
  for (let i = 0; i < sendKeys.length; i += 100) {
    const { error } = await admin.from("duty_items").update({ status: "void", void_reason: "merged", task_id: null, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId).eq("kind", "report_write").eq("cycle", date).in("subject_key", sendKeys.slice(i, i + 100)).or("status.neq.void,void_reason.eq.expired");
    if (error) throw new Error(`의무 장부 정리(작성 → 발송): ${error.message}`);
  }
  return { drafts: drafts.length, ...written };
}

/**
 * 초안을 장부에 쓴다 — 열기(upsert) → 명단에서 빠진 것 void(종류 × 회차마다 · 보고서·상담처럼 열쇠에 담당이 든 종류는 rekey 정리) → 사실로 닫거나 되살림.
 * `kinds`를 주면 초안이 하나도 없는 종류도 그 회차들을 정리한다(예: 신규생이 0명이 된 날).
 */
export async function writeDrafts(tenantId: string, drafts: readonly DutyDraft[], options: { rekey: boolean; /** 초안이 비어도 정리할 종류 → 회차. 건별(case) 종류는 회차 목록 대신 열린 회차를 DB에서 찾는다. */ cyclesOf?: Readonly<Record<string, readonly string[]>>; /** 이미 있는 행의 완료만 맞춘다 — 새로 열지도 · 빼지도 · 담당을 옮기지도 않는다(지난 달 재맞춤). */ resolveOnly?: boolean; /** 지난 달 다시 만들기 — 닫힌 행의 담당도 초안대로 다시 적는다(평가 개시 전 행만 · s2_0090 `duty_reown_items`). */ reown?: boolean } = { rekey: false }): Promise<{ inserted: number; done: number; voided: number }> {
  const admin = createAdminClient();
  let inserted = 0, done = 0, voided = 0;
  for (let i = 0; !options.resolveOnly && i < drafts.length; i += 500) {
    const chunk = drafts.slice(i, i + 500);
    const { data, error } = await admin.rpc("duty_upsert_items", { p_tenant: tenantId, p_items: chunk.map((d) => ({
      kind: d.kind, period: d.period, cycle: d.cycle, subjectKey: d.subjectKey, studentId: d.studentId, classId: d.classId, subject: d.subject,
      ownerId: d.ownerId, ownerSource: d.ownerSource, dueAt: d.dueAt })) });
    if (error) throw new Error(`의무 장부 열기: ${error.message}`);
    inserted += Number((data as { inserted?: number } | null)?.inserted ?? 0);
  }
  // 명단에서 빠진 것(결석 전원 · 반 이동 · 시간표 변경 · 창을 나간 신규생)은 분모에서 뺀다 — 종류 × 회차 안에서만.
  const cycles = new Map<string, Set<string>>();
  for (const d of drafts) cycles.set(d.kind, (cycles.get(d.kind) ?? new Set()).add(d.cycle));
  for (const kind of Object.keys(options.cyclesOf ?? {})) if (!cycles.has(kind)) cycles.set(kind, new Set());
  // 평소에는 끝난 업무의 담당을 옮기지 않는다(실적이 새 담당으로 넘어가지 않게). 지난 달을 다시 만들 때만, 평가 개시 전의 닫힌 행에 한해 그날 기준 담당으로 다시 적는다.
  for (let i = 0; options.reown && !options.resolveOnly && i < drafts.length; i += 500) {
    const { error } = await admin.rpc("duty_reown_items", { p_tenant: tenantId, p_items: drafts.slice(i, i + 500).map((d) => ({ kind: d.kind, cycle: d.cycle, subjectKey: d.subjectKey, ownerId: d.ownerId, ownerSource: d.ownerSource })) });
    if (error) throw new Error(`의무 장부 담당 바로잡기: ${error.message}`);
  }
  for (const [kind, set] of options.resolveOnly ? [] : cycles) {
    // 🔴 초안이 빈 종류는 **부르는 쪽이 지정한 회차만** 정리한다(휴원일에 그날 초안이 비었다고 지난 날들을 void하면 안 된다).
    //    건별(case) 종류만 회차가 항목 키라 열린 회차를 DB에서 찾는다.
    const targets = set.size ? [...set] : options.cyclesOf?.[kind]?.length ? [...options.cyclesOf[kind]!] : DUTY_KINDS[kind as keyof typeof DUTY_KINDS]?.period === "case" ? await openCyclesOfKind(tenantId, kind) : [];
    for (const cycle of targets) {
      const keep = drafts.filter((d) => d.kind === kind && d.cycle === cycle).map((d) => d.subjectKey);
      const { data, error } = await admin.rpc("duty_void_stale", { p_tenant: tenantId, p_kind: kind, p_cycle: cycle, p_keep_keys: keep, p_reason: "not_due", p_rekey: options.rekey });
      if (error) throw new Error(`의무 장부 정리(${kind}): ${error.message}`);
      voided += Number(data ?? 0);
    }
  }
  // 완료만 맞추는 길은 끝난 초안만 보낸다 — 열린 초안이 닿으면 이미 빠지거나 미이행으로 확정된 지난 달 행이 다시 열린다(리뷰 2026-11-11).
  const resolving = options.resolveOnly ? drafts.filter((d) => d.status === "done") : drafts;
  for (let i = 0; i < resolving.length; i += 500) {
    const chunk = resolving.slice(i, i + 500);
    const { data, error } = await admin.rpc("duty_resolve_items", { p_tenant: tenantId, p_updates: chunk.map((d) => ({
      kind: d.kind, subjectKey: d.subjectKey, cycle: d.cycle, status: d.status, source: d.source, doneAt: d.doneAt })) });
    if (error) throw new Error(`의무 장부 맞춤: ${error.message}`);
    const r = data as { done?: number; void?: number } | null;
    done += Number(r?.done ?? 0);
    voided += Number(r?.void ?? 0);
  }
  return { inserted, done, voided };
}

async function openCyclesOfKind(tenantId: string, kind: string): Promise<string[]> {
  const { data, error } = await createAdminClient().from("duty_items").select("cycle").eq("tenant_id", tenantId).eq("kind", kind).eq("status", "open").limit(1000);
  if (error) throw new Error(`의무 열린 회차(${kind}): ${error.message}`);
  return [...new Set(((data ?? []) as { cycle: string }[]).map((r) => r.cycle))];
}

/** 기한이 지났는데 열린 의무가 남은 지난 날들(최근 7일) — 오늘 말고도 다시 맞춰 봐야 닫힌다(다음 날 아침 발송 · 늦게 찍은 출결). */
export async function openPastCycles(tenantId: string): Promise<string[]> {
  const { data, error } = await createAdminClient().rpc("duty_open_cycles", { p_tenant: tenantId, p_days: 7 });
  if (error) throw new Error(`의무 열린 회차: ${error.message}`);
  return ((data ?? []) as string[]).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/**
 * 늦음 사다리(할 일 열기·닫기 · escalation 단계) + 윗단계 배정(3일 → 과목 관리자 · 7일 → 원장 · s2_0078 `duty_escalate_up`) + 일별 스냅숏. 맞춤 뒤에 부른다.
 * 과목 관리자 명단은 앱의 판정(운영실 배정)이라 여기서 읽어 넘긴다. 윗단계 함수가 아직 없으면(#95) 그 몫만 건너뛴다.
 */
export async function escalateAndSnapshot(tenantId: string, days: readonly string[], settings: TenantSettings): Promise<{ taskOpened: number; taskClosed: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("duty_escalate", { p_tenant: tenantId });
  if (error) throw new Error(`의무 늦음 사다리: ${error.message}`);
  const managers = await loadSubjectManagers(tenantId, settings);
  const up = await admin.rpc("duty_escalate_up", { p_tenant: tenantId, p_subjects: Object.fromEntries(Object.entries(managers).map(([key, m]) => [key, { label: m.label, managers: m.ids }])) });
  if (up.error && up.error.code !== "PGRST202" && up.error.code !== "42883") throw new Error(`의무 윗단계 배정: ${up.error.message}`);
  for (const day of days) {
    const snap = await admin.rpc("duty_snapshot", { p_tenant: tenantId, p_day: day });
    if (snap.error) throw new Error(`의무 스냅숏(${day}): ${snap.error.message}`);
  }
  const r = data as { opened?: number; closed?: number } | null;
  return { taskOpened: Number(r?.opened ?? 0), taskClosed: Number(r?.closed ?? 0) };
}
