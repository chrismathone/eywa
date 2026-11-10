import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { loadViewerBundle } from "@/features/dashboard/layout/viewer-server";
import { sliceGroupsOf } from "@/features/dashboard/layout/slices";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import type { DutyPeriod, DutyStatus } from "../kinds";
import type { ClassInfo, Counts, DutyAdminData, DutyAdminScope, LateItem, OwnerInfo, RollupClass, RollupOwnerKind, RollupStudent, StudentInfo } from "../view-admin";

/**
 * 업무 완성도 관리자 화면의 조회 — 장부는 서버 전용 표(정책 0개)라 관리 키로 읽고, **모든 조회에 지점 조건**. 집계는 DB(s2_0049 · B2).
 * 과목 범위 = 운영실과 같은 판정(`loadViewerBundle` — 원장·총괄 = 전체 · 과목 관리자 = 담당 과목 묶음). 담당 과목을 못 읽으면 넓히지 않고 빈 범위.
 */
export async function resolveDutyAdminScope(viewer: CurrentUser): Promise<DutyAdminScope> {
  const [bundle, settings, level, erased, effective] = await Promise.all([loadViewerBundle(viewer), getTenantSettings(), accessLevelTenant(viewer.systemRole, "duties"), readonlyViewErasedScope("duties"), getCurrentUser({ teacherView: true })]);
  const labels = subjectLabelRecord(settings.operations.subjects);
  // '담당'(scoped) 권한 = 본인 의무만 — 역할 표에서 선생님·매니저에게 '담당'으로 열면 자기 줄만 본다(전체는 학원 전체).
  // 🔴 읽기 강사뷰는 scoped를 readonly로 캡해 '담당'이 사라진다 — `readonlyViewErasedScope`가 캡 이전 값이 scoped였는지 알려 준다(perm-matrix 규약 · 재리뷰 2026-11-10).
  //    담당자는 강사뷰면 그 강사(#154).
  const ownerId = level === "scoped" || erased ? (effective ?? viewer).id : null;
  if (!bundle.subjectScoped) return { subjects: null, labels, ownerId };
  // 담당 과목은 자유 글자일 수 있다(키·라벨·'EiE'…) — 운영실과 같은 읽기(`sliceGroupsOf`)로 묶음을 읽고, 그 묶음에 드는 설정 과목 키를 전부 허용한다.
  const programs = programSubjectsOf(labels);
  const groupOf = (key: string | null | undefined) => subjectGroupOf(key, programs);
  const groupsOf = sliceGroupsOf(settings.operations.subjects.map((s) => ({ key: s.key, label: s.label })), groupOf);
  const groups = new Set(bundle.subjects.flatMap((s) => groupsOf(s)));
  const subjects = settings.operations.subjects.map((s) => s.key).filter((key) => { const g = groupOf(key); return !!g && groups.has(g); });
  return { subjects, labels, ownerId };
}

const num = (v: unknown) => Number(v ?? 0);
type CountRow = { total: number; done: number; due: number; ontime: number; late_done: number; open_late: number; expired: number; over7: number };
const counts = (r: CountRow): Counts => ({ total: num(r.total), done: num(r.done), due: num(r.due), ontime: num(r.ontime), lateDone: num(r.late_done), late: num(r.open_late), expired: num(r.expired), over7: num(r.over7) });
/** 지점의 장부 설정(s2_0050) — 평가 시작(live_from: 이보다 앞선 기한은 '이관') · 마지막 맞춤 시각. 줄이 없으면 둘 다 null. */
async function loadDutySettings(tenantId: string): Promise<{ liveFrom: string | null; syncedAt: string | null }> {
  const { data, error } = await createAdminClient().from("duty_settings").select("live_from,last_sync_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`장부 설정: ${error.message}`);
  return { liveFrom: (data?.live_from as string | null) ?? null, syncedAt: (data?.last_sync_at as string | null) ?? null };
}

/** 매트릭스·반별·'오늘 확인할 것' 재료 — 세 조회는 독립(B4). 이름표(담당자·반)는 나온 id만 청크로. */
export async function loadDutyAdmin(tenantId: string, from: string, to: string, scope: DutyAdminScope, periods: string[] | null): Promise<DutyAdminData> {
  const admin = createAdminClient();
  const args = { p_tenant: tenantId, p_from: from, p_to: to, p_subjects: scope.subjects, p_periods: periods, p_owner: scope.ownerId };
  const [ok, cls, lateRaw, settings] = await Promise.all([
    fetchAllPaged<CountRow & { owner_id: string | null; subject: string | null; kind: string; period: DutyPeriod }>((a, b) =>
      admin.rpc("duty_rollup_owner_kind", args).order("owner_id").order("subject").order("kind").order("period").range(a, b)),
    fetchAllPaged<CountRow & { class_id: string | null; owner_id: string | null; subject: string | null }>((a, b) =>
      admin.rpc("duty_rollup_class", args).order("class_id").order("owner_id").order("subject").range(a, b)),
    loadLateItems(tenantId, scope),
    loadDutySettings(tenantId),
  ]);
  const liveMs = settings.liveFrom ? Date.parse(settings.liveFrom) : null;
  const late = lateRaw.map((it): LateItem => ({ ...it, inherited: liveMs !== null && Date.parse(it.dueAt) < liveMs }));
  const ownerKind = ok.map((r): RollupOwnerKind => ({ ownerId: r.owner_id, subject: r.subject, kind: r.kind, period: r.period, ...counts(r) }));
  const classes = cls.map((r): RollupClass => ({ classId: r.class_id, ownerId: r.owner_id, subject: r.subject, ...counts(r) }));
  const ownerIds = [...new Set([...ownerKind.map((r) => r.ownerId), ...classes.map((r) => r.ownerId), ...late.map((r) => r.ownerId)].filter((id): id is string => !!id))];
  const classIds = [...new Set(classes.map((r) => r.classId).filter((id): id is string => !!id))];
  const [owners, classInfo] = await Promise.all([loadOwners(tenantId, ownerIds), loadClasses(tenantId, classIds)]);
  return { ownerKind, classes, late, owners, classInfo, syncedAt: settings.syncedAt };
}

type LateRow = { id: string; kind: string; period: DutyPeriod; cycle: string; status: DutyStatus; due_at: string; done_at: string | null; void_reason: string | null; owner_id: string | null;
  student_id: string | null; class_id: string | null; subject: string | null; escalation: number;
  student: { name: string | null; school: string | null; grade: string | null } | { name: string | null; school: string | null; grade: string | null }[] | null;
  class: { class_name: string | null } | { class_name: string | null }[] | null };
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);
/** 열린 채 기한이 지난 의무 전부(일간은 7일 뒤 확정돼 빠진다 · 월간·건별은 닫힐 때까지 남는다 — 페이지를 넘겨 전건) — 단계 높은 것부터. 임베드는 FK 이름 명시(#94). */
async function loadLateItems(tenantId: string, scope: DutyAdminScope): Promise<Omit<LateItem, "inherited">[]> {
  const admin = createAdminClient();
  const rows = await fetchAllPaged<LateRow>((a, b) => {
    let q = admin.from("duty_items").select("id,kind,period,cycle,status,due_at,done_at,void_reason,owner_id,student_id,class_id,subject,escalation,student:students!duty_items_student_id_fkey(name,school,grade),class:classes!duty_items_class_id_fkey(class_name)")
      .eq("tenant_id", tenantId).eq("status", "open").lt("due_at", new Date().toISOString());
    if (scope.subjects) q = q.in("subject", scope.subjects);
    if (scope.ownerId) q = q.eq("owner_id", scope.ownerId);
    return q.order("escalation", { ascending: false }).order("due_at").order("id").range(a, b);
  });
  return rows.map((r) => {
    const st = one(r.student);
    return { id: r.id, kind: r.kind, period: r.period, cycle: r.cycle, status: r.status, dueAt: r.due_at, doneAt: r.done_at, voidReason: r.void_reason, ownerId: r.owner_id,
      studentId: r.student_id, studentName: st?.name ?? null, school: st?.school ?? null, grade: st?.grade ?? null, classId: r.class_id, className: one(r.class)?.class_name ?? null, subject: r.subject, escalation: r.escalation };
  });
}

async function loadOwners(tenantId: string, ids: string[]): Promise<OwnerInfo> {
  const rows = await fetchInChunks<{ id: string; display_name: string | null }>(ids, (chunk) => createAdminClient().from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk));
  return Object.fromEntries(rows.map((r) => [r.id, r.display_name ?? "이름 없음"]));
}
async function loadClasses(tenantId: string, ids: string[]): Promise<ClassInfo> {
  const rows = await fetchInChunks<{ id: string; class_name: string | null; subject: string | null; teacher_id: string | null }>(ids, (chunk) => createAdminClient().from("classes").select("id,class_name,subject,teacher_id").eq("tenant_id", tenantId).in("id", chunk));
  return Object.fromEntries(rows.map((r) => [r.id, { name: r.class_name ?? "반 이름 없음", subject: r.subject, teacherId: r.teacher_id }]));
}

export type StudentFilter = { owner?: string | null; kind?: string | null; classId?: string | null; subject?: string | null; studentId?: string | null; /** 과목 없는 의무만('과목 미정' 줄). */ subjectNone?: boolean; /** 담당자 없는 의무만('담당 미정' 줄). */ ownerNone?: boolean };
export type DutyStudentsData = { rows: RollupStudent[]; students: StudentInfo; classInfo: ClassInfo };
/** 학생 × 반 × 종류 — 드릴다운(담당자·종류·반 중 아무거나) · '학생별' 보기(필터 없음 · 페이지 넘겨 전건). */
export async function loadDutyStudents(tenantId: string, from: string, to: string, scope: DutyAdminScope, periods: string[] | null, f: StudentFilter): Promise<DutyStudentsData> {
  const admin = createAdminClient();
  const raw = await fetchAllPaged<CountRow & { student_id: string | null; class_id: string | null; kind: string; last_due: string | null }>((a, b) =>
    admin.rpc("duty_rollup_student", { p_tenant: tenantId, p_from: from, p_to: to, p_subjects: scope.subjects, p_periods: periods, p_owner: scope.ownerId ?? (f.ownerNone ? null : f.owner ?? null), p_kind: f.kind ?? null, p_class: f.classId ?? null, p_subject: f.subject ?? null, p_student: f.studentId ?? null, p_subject_none: f.subjectNone ?? false, p_owner_none: !scope.ownerId && (f.ownerNone ?? false) })
      .order("student_id").order("class_id").order("kind").range(a, b));
  const rows = raw.map((r): RollupStudent => ({ studentId: r.student_id, classId: r.class_id, kind: r.kind, ...counts(r), lastDue: r.last_due }));
  const studentIds = [...new Set(rows.map((r) => r.studentId).filter((id): id is string => !!id))];
  const classIds = [...new Set(rows.map((r) => r.classId).filter((id): id is string => !!id))];
  const [students, classInfo] = await Promise.all([
    fetchInChunks<{ id: string; name: string | null; school: string | null; grade: string | null }>(studentIds, (chunk) => admin.from("students").select("id,name,school,grade").eq("tenant_id", tenantId).in("id", chunk))
      .then((rs): StudentInfo => Object.fromEntries(rs.map((r) => [r.id, { name: r.name ?? "학생", school: r.school, grade: r.grade }]))),
    loadClasses(tenantId, classIds),
  ]);
  return { rows, students, classInfo };
}
