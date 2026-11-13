import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { isReadonlyTeacherView, viewAsTeacher } from "@/lib/auth/view-as";
import { canViewReportRatings } from "@/features/report-admin/server/rating-access";
import { loadViewerBundle } from "@/features/dashboard/layout/viewer-server";
import { sliceGroupsOf } from "@/features/dashboard/layout/slices";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { isModuleEnabled } from "@/lib/modules";
import type { DutyPeriod, DutyStatus } from "../kinds";
import { loadReportRatingRows } from "./ratings";
import { loadWithdrawalWriteRows } from "./withdrawal-write";
import { nativeOwnerIds, tenantNativeIds } from "./native";
import { loadVideoHomeworkRows } from "./video-homework";
import { loadLatestNotes } from "./notes";
import type { AbsentRow, ClassInfo, Counts, DutyAdminData, DutyAdminScope, LateItem, OwnerInfo, OwnerLoadRow, RollupClass, RollupOwnerKind, RollupStudent, StudentInfo } from "../view-admin";

/**
 * 업무 완성도 관리자 화면의 조회 — 장부는 서버 전용 표(정책 0개)라 관리 키로 읽고, **모든 조회에 지점 조건**. 집계는 DB(s2_0075 · B2).
 * 과목 범위 = 운영실과 같은 판정(`loadViewerBundle` — 원장·총괄 = 전체 · 과목 관리자 = 담당 과목 묶음). 담당 과목을 못 읽으면 넓히지 않고 빈 범위.
 */
export async function resolveDutyAdminScope(viewer: CurrentUser): Promise<DutyAdminScope> {
  const [bundle, settings, level, erased, effective, unverified, reportsLevel, ratingsOpen] = await Promise.all([loadViewerBundle(viewer), getTenantSettings(), accessLevelTenant(viewer.systemRole, "duties"), readonlyViewErasedScope("duties"), getCurrentUser({ teacherView: true }),
    Promise.all([isReadonlyTeacherView(), viewAsTeacher()]).then(([ro, as]) => ro && !as),
    // 평점 문의 재료 둘도 같은 묶음에서(B4 — 관리자 GET마다 직렬 왕복이 붙지 않게 · 검토 2026-11-12).
    accessLevelTenant(viewer.systemRole, "lesson_reports"), canViewReportRatings(viewer.tenantId, viewer.systemRole)]);
  const labels = subjectLabelRecord(settings.operations.subjects);
  const newcomerShown = isModuleEnabled(settings.modules.disabled, "newcomers");
  // '담당'(scoped) 권한 = 본인 의무만 — 역할 표에서 선생님·매니저에게 '담당'으로 열면 자기 줄만 본다(전체는 학원 전체).
  // 🔴 읽기 강사뷰는 scoped를 readonly로 캡해 '담당'이 사라진다 — `readonlyViewErasedScope`가 캡 이전 값이 scoped였는지 알려 준다(perm-matrix 규약 · 재리뷰 2026-11-10).
  //    담당자는 강사뷰면 그 강사(#154).
  // 강사뷰 대상을 확인하지 못한 요청(읽기 전용인데 대상이 없다)은 권한이 '읽기'로 낮춰져 '담당'이 사라져 보인다 — 본인 것만으로 좁힌다(재리뷰 2026-11-11).
  const ownerId = level === "scoped" || erased || unverified ? (effective ?? viewer).id : null;
  const canNote = level === "full" && !ownerId;
  // 평점은 수업보고서 쓰기 권한자에게만(평점 열람과 같은 문) — 본인 줄만 보는 사람에게는 내려보내지 않는다.
  //   🔴 '담당' 권한은 안 된다 — 수업보고서 목록에서 담당 권한자는 자기 보고서의 평점만 보는데(RLS), 여기서는 모든 선생님의 평균 · 등수가 나간다(리뷰 2026-11-11).
  //   코드 표시 스위치·지점 report_rating·쓰기 권한 중 하나라도 꺼지면 내려보내지 않는다(목록과 같은 단일 문).
  //   🔴 공용 문(`canViewReportRatings`)은 '담당'도 통과시키므로(목록은 RLS가 본인 것만 준다) 여기서는 '전체'를 따로 더 요구한다.
  const seeRatings = !ownerId && reportsLevel === "full" && ratingsOpen;
  if (!bundle.subjectScoped) return { subjects: null, labels, ownerId, newcomerShown, canNote, seeRatings };
  // 담당 과목은 자유 글자일 수 있다(키·라벨·'EiE'…) — 운영실과 같은 읽기(`sliceGroupsOf`)로 묶음을 읽고, 그 묶음에 드는 설정 과목 키를 전부 허용한다.
  const programs = programSubjectsOf(labels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programs);
  const groupsOf = sliceGroupsOf(settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), groupOf);
  const groups = new Set(bundle.subjects.flatMap((s) => groupsOf(s)));
  const subjects = settings.operations.subjects.map((s) => s.key).filter((key) => { const g = groupOf(key); return !!g && groups.has(g); });
  return { subjects, labels, ownerId, newcomerShown, canNote, seeRatings };
}

const num = (v: unknown) => Number(v ?? 0);
type CountRow = { total: number; done: number; due: number; ontime: number; late_done: number; open_late: number; expired: number; over7: number };
const counts = (r: CountRow): Counts => ({ total: num(r.total), done: num(r.done), due: num(r.due), ontime: num(r.ontime), lateDone: num(r.late_done), late: num(r.open_late), expired: num(r.expired), over7: num(r.over7) });
type RollupArgs = { p_tenant: string; p_from: string; p_to: string; p_subjects: string[] | null; p_periods: string[] | null; p_owner: string | null };
type ClassCountRow = CountRow & { class_id: string | null; owner_id: string | null; subject: string | null };

/** 완료 이력을 지우지 않고 숨겨야 하므로, 모듈이 꺼진 동안 반 합계에서 신규생 종류의 몫만 정확히 뺀다. */
async function withoutNewcomerClassCounts(args: RollupArgs, rows: readonly ClassCountRow[]): Promise<ClassCountRow[]> {
  const pairs = [...new Map(rows.map((r) => [JSON.stringify([r.owner_id, r.subject]), { ownerId: r.owner_id, subject: r.subject }])).values()];
  const removed = new Map<string, Counts>();
  const admin = createAdminClient();
  for (let i = 0; i < pairs.length; i += 8) {
    await Promise.all(pairs.slice(i, i + 8).map(async ({ ownerId, subject }) => {
      const { data, error } = await admin.rpc("duty_rollup_student_ex", { ...args, p_owner: ownerId, p_kind: "newcomer_call", p_class: null, p_subject: subject,
        p_student: null, p_subject_none: subject === null, p_owner_none: ownerId === null, p_exclude_owners: [] });
      if (error) throw new Error(`신규생 관리 반 집계 제외: ${error.message}`);
      for (const r of (data ?? []) as (CountRow & { class_id: string | null })[]) {
        const key = JSON.stringify([ownerId, subject, r.class_id]);
        const cur = removed.get(key) ?? { total: 0, done: 0, due: 0, ontime: 0, lateDone: 0, late: 0, expired: 0, over7: 0 };
        removed.set(key, { total: cur.total + num(r.total), done: cur.done + num(r.done), due: cur.due + num(r.due), ontime: cur.ontime + num(r.ontime),
          lateDone: cur.lateDone + num(r.late_done), late: cur.late + num(r.open_late), expired: cur.expired + num(r.expired), over7: cur.over7 + num(r.over7) });
      }
    }));
  }
  const sub = (a: unknown, b: number) => Math.max(num(a) - b, 0);
  return rows.map((r) => {
    const x = removed.get(JSON.stringify([r.owner_id, r.subject, r.class_id]));
    return !x ? { ...r } : { ...r, total: sub(r.total, x.total), done: sub(r.done, x.done), due: sub(r.due, x.due), ontime: sub(r.ontime, x.ontime),
      late_done: sub(r.late_done, x.lateDone), open_late: sub(r.open_late, x.late), expired: sub(r.expired, x.expired), over7: sub(r.over7, x.over7) };
  }).filter((r) => num(r.total) > 0);
}
/** 볼 수 있는 첫 날(s2_0087)로 기간의 시작을 당긴다 — 관리 화면의 모든 조회(집계 · 학생 · 업무 목록)가 같은 시작을 쓴다(한 곳만 당기면 날이 낀 주에서 숫자가 어긋난다). */
export async function clampDutyFrom(tenantId: string, from: string): Promise<string> {
  const { viewFrom } = await loadDutySettings(tenantId);
  return viewFrom && from < viewFrom ? viewFrom : from;
}

/** 지점의 장부 설정(s2_0076) — 평가 시작(live_from: 이보다 앞선 기한은 '이관') · 마지막 맞춤 시각. 줄이 없으면 둘 다 null. */
async function loadDutySettings(tenantId: string): Promise<{ liveFrom: string | null; syncedAt: string | null; viewFrom: string | null }> {
  const { data, error } = await createAdminClient().from("duty_settings").select("live_from,last_sync_at,view_from").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`장부 설정: ${error.message}`);
  return { liveFrom: (data?.live_from as string | null) ?? null, syncedAt: (data?.last_sync_at as string | null) ?? null, viewFrom: (data?.view_from as string | null) ?? null };
}

/** 매트릭스·반별·'오늘 확인할 것' 재료 — 세 조회는 독립(B4). 이름표(담당자·반)는 나온 id만 청크로. */
export async function loadDutyAdmin(tenantId: string, from: string, to: string, scope: DutyAdminScope, periods: string[] | null): Promise<DutyAdminData> {
  const admin = createAdminClient();
  const settings = await loadDutySettings(tenantId);
  // 볼 수 있는 첫 날(s2_0087) 전은 세지 않는다 — 에이와에 기록을 적기 전의 달은 수치가 실제 업무를 말하지 않는다(원장 2026-11-11).
  const args = { p_tenant: tenantId, p_from: settings.viewFrom && from < settings.viewFrom ? settings.viewFrom : from, p_to: to, p_subjects: scope.subjects, p_periods: periods, p_owner: scope.ownerId };
  const [ok, clsRaw, lateRaw, ownerLoad, ratings, withdrawal, video] = await Promise.all([
    fetchAllPaged<CountRow & { owner_id: string | null; subject: string | null; kind: string; period: DutyPeriod }>((a, b) =>
      admin.rpc("duty_rollup_owner_kind", args).order("owner_id").order("subject").order("kind").order("period").range(a, b)),
    fetchAllPaged<CountRow & { class_id: string | null; owner_id: string | null; subject: string | null }>((a, b) =>
      admin.rpc("duty_rollup_class", args).order("class_id").order("owner_id").order("subject").range(a, b)),
    loadLateItems(tenantId, scope, settings.liveFrom),
    // 담당 반 수 · 학생 수(s2_0079) — 함수가 아직 없으면(#95) 빈 값(화면은 반 수만 센다).
    admin.rpc("duty_rollup_owner_load", args).then(({ data, error }): OwnerLoadRow[] => {
      if (error) { if (error.code === "PGRST202" || error.code === "42883") return []; throw new Error(`담당 반·학생 수: ${error.message}`); }
      return ((data ?? []) as { owner_id: string | null; subject: string | null; classes: number; students: number }[]).map((r) => ({ ownerId: r.owner_id, subject: r.subject, classes: num(r.classes), students: num(r.students) }));
    }),
    scope.seeRatings ? loadReportRatingRows(tenantId, args.p_from, to, scope.subjects) : Promise.resolve(undefined),
    // 퇴원보고서 작성(참고 열) — 달 보기에서만(하루 · 한 주 표는 일간 업무만 다룬다).
    periods === null ? loadWithdrawalWriteRows(tenantId, args.p_from, to, scope) : Promise.resolve(undefined),
    // 영상 숙제 출제 · 회수(참고 열 · s2_0094) — 기간 = 숙제일.
    loadVideoHomeworkRows(tenantId, args.p_from, to, scope),
  ]);
  // 신규생 의무는 건별(case) 기간이라, 고른 기간에 case가 없으면(하루 · 한 주 보기) 뺄 몫이 없다 — RPC를 부르지 않는다(검토 2026-11-12).
  const caseInView = !periods || periods.includes("case");
  const cls = scope.newcomerShown === false && caseInView ? await withoutNewcomerClassCounts(args, clsRaw) : clsRaw;
  const liveMs = settings.liveFrom ? Date.parse(settings.liveFrom) : null;
  const notes = await loadLatestNotes(tenantId, lateRaw.map((it) => it.id));
  const late = lateRaw.filter((it) => scope.newcomerShown !== false || it.kind !== "newcomer_call")
    .map((it): LateItem => ({ ...it, inherited: liveMs !== null && Date.parse(it.dueAt) < liveMs, note: notes[it.id] ?? null }));
  const ownerKind = ok.filter((r) => scope.newcomerShown !== false || r.kind !== "newcomer_call")
    .map((r): RollupOwnerKind => ({ ownerId: r.owner_id, subject: r.subject, kind: r.kind, period: r.period, ...counts(r) }));
  const classes = cls.map((r): RollupClass => ({ classId: r.class_id, ownerId: r.owner_id, subject: r.subject, ...counts(r) }));
  const ownerIds = [...new Set([...ownerKind.map((r) => r.ownerId), ...classes.map((r) => r.ownerId), ...late.map((r) => r.ownerId)].filter((id): id is string => !!id))];
  const classIds = [...new Set(classes.map((r) => r.classId).filter((id): id is string => !!id))];
  // 원어민 판정은 참고 열(평점 · 퇴원보고서 · 영상 숙제)의 담당까지 함께 본다 — 그 열에만 있는 원어민이 남지 않게.
  const allOwners = [...new Set([...ownerIds, ...(ratings ?? []).map((r) => r.ownerId), ...(withdrawal ?? []).map((r) => r.ownerId), ...(video ?? []).map((r) => r.ownerId)].filter((id): id is string => !!id))];
  const [owners, classInfo, native] = await Promise.all([loadOwners(tenantId, ownerIds), loadClasses(tenantId, classIds), nativeOwnerIds(tenantId, allOwners)]);
  // 원어민 담당 몫은 집계 · 기한 초과 목록 · 반/학생 수에서 통째로 뺀다 — 줄만 숨기면 과목 합계와 줄의 합이 어긋난다(합계는 남은 줄로 다시 선다).
  // 담당 없는 업무('담당 미정')도 세우지 않는다(원장 2026-11-11 *"담당 미정 … 노출되지 않도록 숨길것 (원어민처럼)"*) — 장부에는 남는다.
  const kept = <T extends { ownerId: string | null }>(rows: T[]): T[] => rows.filter((r) => !!r.ownerId && !native.has(r.ownerId));
  return { ownerKind: kept(ownerKind), classes: kept(classes), late: kept(late), owners: owners.names, classInfo, syncedAt: settings.syncedAt, liveFrom: settings.liveFrom, viewFrom: settings.viewFrom, ratings: ratings ? kept(ratings) : undefined, withdrawal: withdrawal ? kept(withdrawal) : undefined, video: video ? kept(video) : undefined, ownerLoad: kept(ownerLoad), managerIds: owners.managerIds };
}

type LateRow = { id: string; kind: string; period: DutyPeriod; cycle: string; status: DutyStatus; due_at: string; done_at: string | null; void_reason: string | null; owner_id: string | null;
  student_id: string | null; class_id: string | null; subject: string | null; escalation: number;
  student: { name: string | null; school: string | null; grade: string | null } | { name: string | null; school: string | null; grade: string | null }[] | null;
  class: { class_name: string | null } | { class_name: string | null }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
/** 열린 채 기한이 지난 의무 전부(일간은 7일 뒤 확정돼 빠진다 · 월간·건별은 닫힐 때까지 남는다 — 페이지를 넘겨 전건) — 단계 높은 것부터. 임베드는 FK 이름 명시(#94). */
async function loadLateItems(tenantId: string, scope: DutyAdminScope, liveFrom: string | null): Promise<Omit<LateItem, "inherited">[]> {
  const admin = createAdminClient();
  const rows = await fetchAllPaged<LateRow>((a, b) => {
    let q = admin.from("duty_items").select("id,kind,period,cycle,status,due_at,done_at,void_reason,owner_id,student_id,class_id,subject,escalation,student:students!duty_items_student_id_fkey(name,school,grade),class:classes!duty_items_class_id_fkey(class_name)")
      .eq("tenant_id", tenantId).eq("status", "open").lt("due_at", new Date().toISOString());
    // 평가 개시 전에 기한이 지난 것(이관)은 화면에 보이지 않는다 — 받지도 않는다(닫힐 때까지 쌓이는 목록이라 갱신마다 헛되이 실린다).
    if (liveFrom) q = q.gte("due_at", liveFrom);
    if (scope.subjects) q = q.in("subject", scope.subjects);
    if (scope.ownerId) q = q.eq("owner_id", scope.ownerId);
    if (scope.newcomerShown === false) q = q.neq("kind", "newcomer_call");
    return q.order("escalation", { ascending: false }).order("due_at").order("id").range(a, b);
  });
  return rows.map((r) => {
    const st = one(r.student);
    return { id: r.id, kind: r.kind, period: r.period, cycle: r.cycle, status: r.status, dueAt: r.due_at, doneAt: r.done_at, voidReason: r.void_reason, ownerId: r.owner_id,
      studentId: r.student_id, studentName: st?.name ?? null, school: st?.school ?? null, grade: st?.grade ?? null, classId: r.class_id, className: one(r.class)?.class_name ?? null, subject: r.subject, escalation: r.escalation };
  });
}

async function loadOwners(tenantId: string, ids: string[]): Promise<{ names: OwnerInfo; managerIds: string[] }> {
  const rows = await fetchInChunks<{ id: string; display_name: string | null; system_role: string | null }>(ids, (chunk) => createAdminClient().from("users").select("id,display_name,system_role").eq("tenant_id", tenantId).in("id", chunk));
  return { names: Object.fromEntries(rows.map((r) => [r.id, r.display_name ?? "이름 없음"])), managerIds: rows.filter((r) => r.system_role === "admin" || r.system_role === "master").map((r) => r.id) };
}
async function loadClasses(tenantId: string, ids: string[]): Promise<ClassInfo> {
  const rows = await fetchInChunks<{ id: string; class_name: string | null; subject: string | null; teacher_id: string | null }>(ids, (chunk) => createAdminClient().from("classes").select("id,class_name,subject,teacher_id").eq("tenant_id", tenantId).in("id", chunk));
  return Object.fromEntries(rows.map((r) => [r.id, { name: r.class_name ?? "반 이름 없음", subject: r.subject, teacherId: r.teacher_id }]));
}

export type StudentFilter = { owner?: string | null; kind?: string | null; classId?: string | null; subject?: string | null; studentId?: string | null; /** 과목 없는 의무만('과목 미정' 줄). */ subjectNone?: boolean; /** 담당자 없는 의무만('담당 미정' 줄). */ ownerNone?: boolean };
export type DutyStudentsData = { rows: RollupStudent[]; students: StudentInfo; classInfo: ClassInfo; absent: AbsentRow[] };
/** 학생 × 반 × 종류 — 드릴다운(담당자·종류·반 중 아무거나) · '학생별' 보기(필터 없음 · 페이지 넘겨 전건). */
export async function loadDutyStudents(tenantId: string, from: string, to: string, scope: DutyAdminScope, periods: string[] | null, f: StudentFilter): Promise<DutyStudentsData> {
  const admin = createAdminClient();
  // 원어민 담당 몫은 합치기 전에 뺀다(s2_0088) — 선생님 · 반 집계와 같은 숫자가 되게.
  // 평가 개시일은 결석 조회의 범위에 쓴다(집계 · 칸 목록과 같은 조건) — 원어민 목록과 서로 무관하니 함께 읽는다(B4).
  // 🔴 개시일을 못 읽으면 결석 수를 세지 않는다(범위를 모르는 채 세면 개시 전 날까지 넓게 센다 — 칸 목록은 같은 실패에서 오류를 던진다 · 3차 리뷰).
  const [native, liveRow] = await Promise.all([tenantNativeIds(tenantId), admin.from("duty_settings").select("live_from").eq("tenant_id", tenantId).maybeSingle()]);
  const liveKnown = !liveRow.error;
  const live = (liveRow.data?.live_from as string | null) ?? null;
  const raw = await fetchAllPaged<CountRow & { student_id: string | null; class_id: string | null; kind: string; last_due: string | null }>((a, b) =>
    admin.rpc("duty_rollup_student_ex", { p_exclude_owners: native, /* 빈 목록이어도 넘긴다 — 담당 없는 업무를 함께 뺀다(s2_0090) */ p_tenant: tenantId, p_from: from, p_to: to, p_subjects: scope.subjects, p_periods: periods, p_owner: scope.ownerId ?? (f.ownerNone ? null : f.owner ?? null), p_kind: f.kind ?? null, p_class: f.classId ?? null, p_subject: f.subject ?? null, p_student: f.studentId ?? null, p_subject_none: f.subjectNone ?? false, p_owner_none: !scope.ownerId && (f.ownerNone ?? false) })
      .order("student_id").order("class_id").order("kind").range(a, b));
  // 결석으로 빠진 일간 의무(void · absent) — 집계에는 없지만 칸에 '결석'이라고 적으려고 같은 범위로 따로 읽는다(하루 · 한 주 · 한 달 안의 수업일).
  // 🔴 평가 개시일 조건도 집계 · 칸 목록과 같게 건다 — 안 걸면 칸은 '결석 5'인데 눌러 연 목록은 '결석 2건'이 된다(2차 리뷰 2026-11-11).
  const liveDay = live ? new Date(Date.parse(live) + 9 * 3_600_000).toISOString().slice(0, 10) : null;
  const absentAll = !liveKnown ? [] : await fetchAllPaged<{ student_id: string | null; class_id: string | null; kind: string; owner_id: string | null }>((a, b) => {
    let q = admin.from("duty_items").select("student_id,class_id,kind,owner_id").eq("tenant_id", tenantId).eq("period", "daily").eq("status", "void").eq("void_reason", "absent").gte("cycle", from).lte("cycle", to).not("student_id", "is", null).not("owner_id", "is", null);
    if (scope.subjects) q = q.in("subject", scope.subjects);
    if (scope.ownerId) q = q.eq("owner_id", scope.ownerId); else if (f.ownerNone) q = q.is("owner_id", null); else if (f.owner) q = q.eq("owner_id", f.owner);
    if (f.kind) q = q.eq("kind", f.kind);
    if (f.classId) q = q.eq("class_id", f.classId);
    if (f.subjectNone) q = q.is("subject", null); else if (f.subject) q = q.eq("subject", f.subject);
    if (f.studentId) q = q.eq("student_id", f.studentId);
    if (live && !(liveDay && to < liveDay)) q = q.gte("due_at", live);
    return q.order("id").range(a, b);
  });
  // 원어민 담당 몫은 여기서 뺀다(조회 조건을 더 잇지 않는다 — 조건 사슬이 길어지면 타입 계산이 멈춘다).
  const absentRaw = native.length ? absentAll.filter((r) => !r.owner_id || !native.includes(r.owner_id)) : absentAll;
  const absentBy = new Map<string, AbsentRow>();
  for (const r of absentRaw) { if (!r.student_id) continue; const key = `${r.student_id}|${r.class_id ?? ""}|${r.kind}`; const cur = absentBy.get(key) ?? { studentId: r.student_id, classId: r.class_id, kind: r.kind, count: 0 }; cur.count++; absentBy.set(key, cur); }
  const rows = raw.filter((r) => scope.newcomerShown !== false || r.kind !== "newcomer_call")
    .map((r): RollupStudent => ({ studentId: r.student_id, classId: r.class_id, kind: r.kind, ...counts(r), lastDue: r.last_due }));
  const studentIds = [...new Set(rows.map((r) => r.studentId).filter((id): id is string => !!id))];
  const classIds = [...new Set(rows.map((r) => r.classId).filter((id): id is string => !!id))];
  const [students, classInfo] = await Promise.all([
    fetchInChunks<{ id: string; name: string | null; school: string | null; grade: string | null }>(studentIds, (chunk) => admin.from("students").select("id,name,school,grade").eq("tenant_id", tenantId).in("id", chunk))
      .then((rs): StudentInfo => Object.fromEntries(rs.map((r) => [r.id, { name: r.name ?? "학생", school: r.school, grade: r.grade }]))),
    loadClasses(tenantId, classIds),
  ]);
  return { rows, students, classInfo, absent: [...absentBy.values()] };
}
