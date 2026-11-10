import "server-only";
import { cache } from "react";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { menuGate } from "@/lib/auth/menu-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { readableFactStudents } from "@/features/student-contribution/server/fact-access";
import { isMergedStudent } from "@/features/students/status/merged";
import { sectionResult } from "@/features/students/ontology/live-contract";
import { unavailableSection } from "@/features/student-contribution/server/live-context";
import { kstToday } from "@/lib/date-kst";
import { latestRecords, knowledgeDocument, saveRequest, validateTransition, type KnowledgeRecord } from "./records";
import type { Person, Staff } from "./types";

/**
 * 현장 관찰·후속 조치·OKR·운영 보완 자료 — aywa-next(4cd839b5e)를 옮겼다(2026-11-11 · 표 s2_0066).
 * 문 = '업무 작성센터' 권한(work_records — 화면 /work-records/knowledge와 같은 문). 작성 = 그 권한 쓰기(본인 관찰만 · 검토 요청까지).
 * 검토(관찰 확인 · 후속 조치·OKR·운영 자료 작성 · 학원 전체 기록 열람) = 그 권한 쓰기 + '경영 분석·지식그래프'(management) '전체'.
 * 학생은 담당 범위(readableFactStudents) 안에서만 — 범위 밖 학생의 기록은 목록에서도 뺀다.
 */
const columns = "id,record_id,version,author_id,actor_id,document,recorded_at";
export const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];

export async function knowledgeAccess(write = false) {
  const gate = await menuGate("work_records");
  if (!gate || !STAFF_ROLES.includes(gate.user.systemRole)) throw Error("기록을 열람할 권한이 없습니다");
  if (write && !gate.write) throw Error("기록을 작성할 권한이 없습니다");
  const [management, readable] = await Promise.all([menuGate("management"), readableFactStudents()]);
  // reviewer = 확인·후속 조치를 실제로 쓸 수 있는가 · seeAll = 지점 전체 기록을 읽는가(지점 보기에서도 원장 자리 그대로).
  return { user: gate.user, writable: gate.write, reviewer: gate.write && !!management?.manage, seeAll: !!management?.readAll, readable };
}

/** 지점의 실제 학생(검증용·병합 제외) — 담당 범위가 있으면 그 안만. */
export const loadKnowledgeStudents = cache(async (tenant: string, readable: Set<string> | null): Promise<Person[]> => {
  const db = createAdminClient();
  const raw = await fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null; is_test: boolean | null; notes: string | null }>((a, b) => db.from("students").select("id,name,school,grade,is_test,notes").eq("tenant_id", tenant).order("id").range(a, b));
  return raw.filter(s => !s.is_test && !isMergedStudent(s.notes) && (readable === null || readable.has(s.id))).map(({ id, name, school, grade }) => ({ id, name, school, grade }));
});

export async function loadKnowledgeRecords() {
  const gate = await knowledgeAccess(), db = createAdminClient(), tenant = gate.user.tenantId;
  const [history, students, users] = await Promise.all([
    fetchAllPaged<KnowledgeRecord>((a, b) => { let q = db.from("academy_knowledge_records").select(columns).eq("tenant_id", tenant); if (!gate.seeAll) q = q.eq("author_id", gate.user.id); return q.order("id").range(a, b); }),
    loadKnowledgeStudents(tenant, gate.readable),
    gate.seeAll ? fetchAllPaged<Staff>((a, b) => db.from("users").select("id,display_name").eq("tenant_id", tenant).eq("status", "active").in("system_role", STAFF_ROLES).order("id").range(a, b)) : Promise.resolve<Staff[]>([{ id: gate.user.id, display_name: gate.user.displayName || "나" }]),
  ]);
  const allowed = new Set(students.map(s => s.id));
  const safeHistory = history.filter(r => !("studentId" in r.document) || !r.document.studentId || allowed.has(r.document.studentId));
  // 홍보 캠페인 표는 아직 이 DB에 없다(연간 운영계획·홍보는 다른 작업에서 다시 만드는 중) — 콘텐츠 성과는 캠페인 연결 없이 기록한다.
  const campaigns: { id: string; label: string }[] = [];
  return { records: latestRecords(safeHistory), history: safeHistory, students, users, campaigns, today: kstToday(), actorId: gate.user.id, canReview: gate.reviewer, seeAll: gate.seeAll, canWrite: gate.writable };
}
export type KnowledgeRecordsData = Awaited<ReturnType<typeof loadKnowledgeRecords>>;

export async function saveKnowledgeRecord(raw: unknown) {
  const input = saveRequest.parse(raw), gate = await knowledgeAccess(true), db = createAdminClient(), tenant = gate.user.tenantId, d = input.document;
  if (d.date > kstToday()) throw Error("기록 기준일은 오늘까지 입력해 주세요");
  const oldResult = await db.from("academy_knowledge_records").select(columns).eq("tenant_id", tenant).eq("record_id", input.id).order("version", { ascending: false }).limit(1).maybeSingle();
  if (oldResult.error) throw Error("기록 버전을 확인하지 못했습니다");
  const old = (oldResult.data as KnowledgeRecord | null) ?? undefined;
  validateTransition(old, d, gate.user.id, gate.reviewer);
  if ("studentId" in d && d.studentId) {
    if (gate.readable !== null && !gate.readable.has(d.studentId)) throw Error("담당 학생 범위를 확인해 주세요");
    const r = await db.from("students").select("id,is_test,notes").eq("tenant_id", tenant).eq("id", d.studentId).maybeSingle();
    if (r.error || !r.data || r.data.is_test || isMergedStudent(r.data.notes)) throw Error("대상 학생을 확인해 주세요");
  }
  if ("ownerId" in d) { const r = await db.from("users").select("id").eq("tenant_id", tenant).eq("status", "active").in("system_role", STAFF_ROLES).eq("id", d.ownerId).maybeSingle(); if (r.error || !r.data) throw Error("담당자를 확인해 주세요"); }
  if (d.kind === "content" && d.campaignId) throw Error("연결할 캠페인을 확인해 주세요");
  if (d.kind === "action" && d.originId) { const r = await db.from("academy_knowledge_records").select("document").eq("tenant_id", tenant).eq("record_id", d.originId).order("version", { ascending: false }).limit(1).maybeSingle(); if (r.error || r.data?.document.kind !== "observation" || r.data.document.studentId !== d.studentId) throw Error("같은 학생의 관찰 기록을 연결해 주세요"); }
  // 같은 요청의 재시도는 같은 결과 · 내용이 바뀐 옛 요청은 충돌. 권한 판정은 이 갈래보다 앞에서 끝났다.
  if (old && old.version === input.expectedVersion + 1 && old.actor_id === gate.user.id && JSON.stringify(knowledgeDocument.parse(old.document)) === JSON.stringify(d)) return { id: old.record_id, version: old.version };
  if ((old?.version ?? 0) !== input.expectedVersion) throw Error("다른 변경이 있습니다. 새로고침 후 확인해 주세요");
  const saved = await db.from("academy_knowledge_records").insert({ tenant_id: tenant, record_id: input.id, version: input.expectedVersion + 1, author_id: old?.author_id ?? gate.user.id, actor_id: gate.user.id, document: d }).select("record_id,version").single();
  if (saved.error) {
    console.error("[academy-knowledge] save record", saved.error.code, saved.error.message);
    throw Error(saved.error.message.includes("knowledge_version_conflict") || saved.error.code === "23505" ? "다른 변경이 있습니다. 새로고침 후 확인해 주세요" : "저장하지 못했습니다. 기록과 권한을 확인해 주세요");
  }
  return { id: saved.data.record_id as string, version: saved.data.version as number };
}

/** 학생 통합보기의 '현장 관찰·후속 조치' — 지점 전체 그래프와 따로, 그 학생 한 명만 읽는다. */
export async function studentKnowledgeSection(studentId: string) {
  const href = `/work-records/knowledge?student=${studentId}`;
  // 권한·담당 범위 밖이면 '열람 제한'으로 밝힌다(조회 실패와 구분 · 기록이 없다고 말하지 않는다).
  const gate = await menuGate("work_records");
  if (!gate || !await canAccessTenant(gate.user.systemRole, "students")) return unavailableSection("field-observations", "현장 관찰·후속 조치", href, "forbidden");
  const readable = await readableFactStudents();
  if (readable !== null && !readable.has(studentId)) return unavailableSection("field-observations", "현장 관찰·후속 조치", href, "forbidden");
  const db = createAdminClient(), user = gate.user;
  const history = await fetchAllPaged<KnowledgeRecord>((a, b) => db.from("academy_knowledge_records").select(columns).eq("tenant_id", user.tenantId).eq("document->>studentId", studentId).order("id").range(a, b));
  const rows = latestRecords(history).filter(r => r.document.kind === "action" || r.document.kind === "observation" && (r.document.state === "confirmed" || r.document.state === "submitted" && r.author_id === user.id));
  const actors = await fetchInChunks<Staff>([...new Set(rows.flatMap(r => [r.author_id, r.actor_id, ...("ownerId" in r.document ? [r.document.ownerId] : [])]))], (ids) => db.from("users").select("id,display_name").eq("tenant_id", user.tenantId).in("id", ids));
  const names = new Map(actors.map(a => [a.id, a.display_name]));
  const actionState: Record<string, string> = { open: "진행 중", done: "완료", cancelled: "취소" };
  return sectionResult("field-observations", "현장 관찰·후속 조치", href, rows.map(r => {
    const d = r.document;
    return { id: r.record_id, title: d.title, date: d.date,
      detail: d.kind === "observation" ? `작성 ${names.get(r.author_id) ?? "담당자"}${r.actor_id !== r.author_id ? ` · 마지막 수정 ${names.get(r.actor_id) ?? "검토자"}` : ""} · ${d.state === "confirmed" ? "확인됨" : "검토 요청"}\n관찰 사실: ${d.fact}\n해석: ${d.interpretation || "없음"}\n근거: ${d.evidence}`
        : d.kind === "action" ? `담당 ${names.get(d.ownerId) ?? "담당자"} · 기한 ${d.due} · ${actionState[d.state] ?? "상태 확인 필요"}\n계획: ${d.plan}\n결과: ${d.result || "아직 없음"}` : "",
      evidence: [{ source: "academy_knowledge_records", id: r.id, studentId, href: `/work-records/knowledge?record=${r.record_id}` }] };
  }), rows.length);
}
