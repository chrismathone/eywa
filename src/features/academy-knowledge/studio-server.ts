import "server-only";
import { menuGate } from "@/lib/auth/menu-gate";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { readableFactStudents } from "@/features/student-contribution/server/fact-access";
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

const columns = "key,version,document,actor_id,recorded_at";
const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];
export async function loadStudioStore() {
  const gate = await knowledgeGate(), db = createAdminClient();
  const history = await fetchAllPaged<StudioRow>((a, b) => db.from("academy_model_versions").select(columns).eq("tenant_id", gate.user.tenantId).order("key").order("version").range(a, b));
  return { rows: latestStudio(history), history, canWrite: gate.manage };
}

/** 정의 사전 항목의 빈값 점검 — 학생·강좌·직원 원본을 그대로 센다(위치 번호로 추정하지 않는다 · 조회 실패는 미입력으로 세지 않는다). */
export async function loadFieldAudit(): Promise<{ fields: FieldAudit[]; errors: string[]; asOf: string }> {
  const gate = await knowledgeGate(), db = createAdminClient(), fields: FieldAudit[] = [], errors: string[] = [];
  // 원본마다 그 화면의 열람 권한을 본다(운영 계정은 통과) — 권한 밖 원본은 이름을 내지 않고 '점검하지 않음'으로 밝힌다. 학생은 담당 범위 안만.
  const MENU = { students: "students", classes: "classes", users: "staff" } as const;
  const [readable, ...allowed] = await Promise.all([readableFactStudents(), ...auditSources.map(s => gate.superAdmin ? true : canAccessTenant(gate.user.systemRole, MENU[s.table]))]);
  await Promise.all(auditSources.map(async (source, i) => {
    if (!allowed[i]) { errors.push(`${source.sheet}: 원본 열람 권한 없음 · 점검하지 않음`); return; }
    try {
      let records = await fetchAllPaged<Record<string, unknown>>((a, b) => db.from(source.table).select(source.select as string).eq("tenant_id", gate.user.tenantId).order("id").range(a, b).overrideTypes<Record<string, unknown>[], { merge: false }>());
      records = records.filter(r => source.table === "students" ? !r.is_test && !isMergedStudent(r.notes as string | null) && (readable === null || readable.has(String(r.id))) : source.table === "classes" ? r.is_active : r.status === "active" && STAFF_ROLES.includes(String(r.system_role)));
      for (const [label, column] of Object.entries(source.map)) {
        const missing = records.filter(r => r[column] === null || r[column] === undefined || String(r[column]).trim() === "");
        fields.push({ key: auditFieldKey(source.sheet, label), total: records.length, missing: missing.length, scope: source.scope,
          examples: missing.slice(0, 20).map(r => ({ label: String(r.name ?? r.class_name ?? r.display_name ?? "기록"), href: source.table === "students" ? `/students/${r.id}` : source.table === "classes" ? "/classes" : "/staff" })) });
      }
    } catch (e) { console.error("[academy-knowledge] audit", source.table, e); errors.push(`${source.sheet}: 원본 조회 실패 · 미입력으로 집계하지 않음`); }
  }));
  return { fields, errors, asOf: kstToday() };
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
