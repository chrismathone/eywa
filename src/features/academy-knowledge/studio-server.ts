import "server-only";
import { menuGate, type MenuGate } from "@/lib/auth/menu-gate";
import { accessLevelTenant, canAccessTenant, readonlyViewErasedScope } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeacherReadScope } from "@/lib/auth/teacher-read-scope";
import { readableFactStudents } from "@/features/student-contribution/server/fact-access";
import { getViewerStaffScope } from "@/features/staff/department/server/subject-scope";
import { isStaffInSubjectScope } from "@/features/staff/department/subject-scope";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { isMergedStudent } from "@/features/students/status/merged";
import { latestStudio, studioRequest, validateStudioKey, type StudioRow } from "./studio-model";
import { auditSources, auditFieldKey } from "./studio-audit";
import type { FieldAudit } from "./types";

/**
 * 스키마 스튜디오 — aywa-next(28708817f · 310eb9379)를 옮겼다(2026-11-11 · 표 s2_0068).
 * 문 = '경영 분석·지식그래프'(management). 읽기 = 그 권한 · 고치기(항목 정의·점검 기준·참고 연결) = 그 권한 '전체'.
 */
export async function knowledgeGate(write = false) {
  const gate = await menuGate("management");
  if (!gate) throw Error("경영 분석·지식그래프 열람 권한이 없습니다");
  if (write && !gate.manage) throw Error("모델을 수정할 권한이 없습니다");
  return gate;
}

/**
 * 원본 화면의 권한을 그대로 따르는 범위 — 지식그래프·빈값 점검·JSON 내려받기가 **같은 함수**를 지난다(#77 · Claude·Codex 검토 2026-11-11).
 *  · students = 원생목록 열람(담당 범위는 readableFactStudents가 따로 좁힌다)
 *  · staff = 직원관리 열람 · staffSubjects = 그 화면의 과목 범위(원장이 지정한 사람은 그 과목 직원만 — null이면 전체)
 *  · classes = 수업목록과 같은 판정: 'none' 권한 없음 · { ids } 강사(본인 · 강사뷰)는 **권한 수준과 무관하게** 가르치는 반만
 *    (담임 · 이번 주 교시 담당 · 위임 — getTeacherReadScope · 수업목록이 쓰는 바로 그 범위) · '담당' 수준인 다른 역할도 같다 · 그 밖은 'all'.
 *    🔴 권한 수준만 보고 'all'로 두지 말 것 — 강사에게 수업목록을 '읽기'로 열면 수준은 readonly인데 수업목록은 여전히 자기 반만 보여 준다(Codex 협의 2026-11-11).
 * 운영 계정은 전부 통과(다른 강사 뷰에서는 운영 계정으로 치지 않는다 — isCurrentUserSuperAdmin).
 */
export type ClassScope = "all" | "none" | { ids: readonly string[] };
export type KnowledgeSourceScope = { students: boolean; staff: boolean; staffSubjects: readonly string[] | null; classes: ClassScope };
export async function knowledgeSourceScope(gate: MenuGate): Promise<KnowledgeSourceScope> {
  if (gate.superAdmin) return { students: true, staff: true, staffSubjects: null, classes: "all" };
  const role = gate.user.systemRole;
  const [students, staff, classLevel, classErased, teacherId] = await Promise.all([canAccessTenant(role, "students"), canAccessTenant(role, "staff"), accessLevelTenant(role, "classes"), readonlyViewErasedScope("classes"), effectiveTeacherId()]);
  const scopedTo = teacherId ?? (classLevel === "scoped" || classErased ? gate.user.id : null);
  const [staffSubjects, classes] = await Promise.all([
    staff ? getViewerStaffScope(gate.user) : null,
    classLevel === "none" ? "none" as const : scopedTo ? getTeacherReadScope(scopedTo).then(s => ({ ids: s.classIds })) : "all" as const,
  ]);
  return { students, staff, staffSubjects, classes };
}

const columns = "key,version,document,actor_id,recorded_at";
const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];
export async function loadStudioStore() {
  const gate = await knowledgeGate(), db = createAdminClient();
  const history = await fetchAllPaged<StudioRow>((a, b) => db.from("academy_model_versions").select(columns).eq("tenant_id", gate.user.tenantId).order("key").order("version").range(a, b));
  return { rows: latestStudio(history), history, canWrite: gate.manage };
}

/** 정의 사전 항목의 빈값 점검 — 학생·강좌·직원 원본을 그대로 센다(위치 번호로 추정하지 않는다 · 조회 실패는 미입력으로 세지 않는다). */
export async function loadFieldAudit(): Promise<{ fields: FieldAudit[]; errors: string[]; asOf: string; ran: boolean }> {
  const gate = await knowledgeGate(), db = createAdminClient(), fields: FieldAudit[] = [], errors: string[] = [];
  // 원본마다 그 화면의 열람 권한을 본다(운영 계정은 통과) — 권한 밖 원본은 이름을 내지 않고 '점검하지 않음'으로 밝힌다.
  // 학생은 담당 범위 안만 · 직원은 직원관리의 과목 범위 안만(직원 목록과 같은 판정 — 본인은 남긴다) · 강좌는 수업목록과 같은 범위(강사는 가르치는 반만).
  const [readable, scope] = await Promise.all([readableFactStudents(), knowledgeSourceScope(gate)]);
  const allowed = { students: scope.students, classes: scope.classes !== "none", users: scope.staff };
  const classIds = new Set(typeof scope.classes === "object" ? scope.classes.ids : []);
  await Promise.all(auditSources.map(async source => {
    if (!allowed[source.table]) { errors.push(`${source.sheet}: 원본 열람 권한 없음 · 점검하지 않음`); return; }
    try {
      let records = await fetchAllPaged<Record<string, unknown>>((a, b) => db.from(source.table).select(source.select as string).eq("tenant_id", gate.user.tenantId).order("id").range(a, b).overrideTypes<Record<string, unknown>[], { merge: false }>());
      records = records.filter(r => source.table === "students" ? !r.is_test && !isMergedStudent(r.notes as string | null) && (readable === null || readable.has(String(r.id))) : source.table === "classes" ? r.is_active && (scope.classes === "all" || classIds.has(String(r.id))) : r.status === "active" && STAFF_ROLES.includes(String(r.system_role)) && (r.id === gate.user.id || isStaffInSubjectScope(scope.staffSubjects, r.subjects as string[] | null)));
      for (const [label, column] of Object.entries(source.map)) {
        const missing = records.filter(r => r[column] === null || r[column] === undefined || String(r[column]).trim() === "");
        fields.push({ key: auditFieldKey(source.sheet, label), total: records.length, missing: missing.length, scope: source.scope,
          examples: missing.slice(0, 20).map(r => ({ label: String(r.name ?? r.class_name ?? r.display_name ?? "기록"), href: source.table === "students" ? `/students/${r.id}` : source.table === "classes" ? "/classes" : "/staff" })) });
      }
    } catch (e) { console.error("[academy-knowledge] audit", source.table, e); errors.push(`${source.sheet}: 원본 조회 실패 · 미입력으로 집계하지 않음`); }
  }));
  return { fields, errors, asOf: kstToday(), ran: true };
}

export async function saveStudio(raw: unknown) {
  const gate = await knowledgeGate(true), user = gate.user;
  const input = studioRequest.parse(raw);
  validateStudioKey(input.key, input.document);
  const db = createAdminClient();
  const oldResult = await db.from("academy_model_versions").select(columns).eq("tenant_id", user.tenantId).eq("key", input.key).order("version", { ascending: false }).limit(1).maybeSingle();
  if (oldResult.error) throw Error("변경 이력을 조회하지 못했습니다");
  const old = oldResult.data as StudioRow | null;
  if (old && old.document.kind !== input.document.kind) throw Error("기록 유형을 바꿀 수 없습니다");
  if (input.document.kind === "link") {
    const d = input.document;
    if (d.date > kstToday()) throw Error("관계의 확인일은 오늘까지 입력해 주세요");
    if (!d.from.startsWith(`${user.tenantId}:`) || !d.to.startsWith(`${user.tenantId}:`)) throw Error("현재 학원의 기록만 연결할 수 있습니다");
    // 양 끝 기록은 서버가 같은 조회 범위로 다시 불러와 확인한다 — 화면이 보낸 이름·ID를 믿지 않는다.
    const { loadAcademyKnowledge } = await import("./server");
    const data = await loadAcademyKnowledge(input.context);
    if (!data.graph.nodes.some(n => n.id === d.from) || !data.graph.nodes.some(n => n.id === d.to)) throw Error("두 기록을 같은 조회 범위에서 불러온 뒤 연결해 주세요");
  }
  if ((old?.version ?? 0) !== input.expectedVersion) throw Error("다른 변경이 있습니다. 새로고침하여 최신 내용을 확인해 주세요");
  const saved = await db.from("academy_model_versions").insert({ tenant_id: user.tenantId, key: input.key, version: input.expectedVersion + 1, document: input.document, actor_id: user.id }).select(columns).single();
  if (saved.error) {
    console.error("[academy-knowledge] save studio", saved.error.code, saved.error.message);
    throw Error(saved.error.code === "23505" || saved.error.message.includes("model_version_conflict") ? "다른 변경이 먼저 저장되었습니다. 새로고침해 주세요" : "저장하지 못했습니다. 잠시 후 다시 확인해 주세요");
  }
  return saved.data as StudioRow;
}
