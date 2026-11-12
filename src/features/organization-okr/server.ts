import "server-only";
import { z } from "zod";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { menuGate } from "@/lib/auth/menu-gate";
import { workAccess } from "@/features/work-records/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { requestSchema, validateGoal, assertSave, okrGraph, type OkrRecord, type OkrDocument, type Evidence } from "./model";

/**
 * 조직·OKR 서버 — aywa-next(3038c5875 · b9cd3c244)를 옮겼다(2026-11-11 · 표 s2_0050).
 * 문 = 역할·권한 '조직·OKR'(okr). 작성 = 그 권한 쓰기 · 관리자(남의 목표 열람·피드백 · 조직/팀 목표) = 원장·관리자·매니저 + 그 권한 '전체'.
 * 담당자 본인만 자기 목표를 쓴다(관리자도 대신 쓰지 않는다) · 개인 목표의 상세·피드백은 담당자와 관리자만 · 공유는 '실행 중' 조직·팀 목표의 요약뿐.
 */
const fields = "id,owner_id,version,document,review,updated_at";
const STAFF_ROLES = ["master", "admin", "manager", "teacher", "counselor", "accountant"];
const MANAGER_ROLES = ["master", "admin", "manager"];

export async function okrAccess() {
  const gate = await menuGate("okr");
  if (!gate || !STAFF_ROLES.includes(gate.user.systemRole)) throw Error("조직·OKR 열람 권한을 확인해 주세요");
  const role = MANAGER_ROLES.includes(gate.user.systemRole);
  // seeAll = 남의 목표까지 읽는가(지점 보기에서도 원장 자리 그대로) · manager = 피드백·조직/팀 목표를 실제로 쓸 수 있는가.
  return { user: gate.user, writable: gate.write, manager: gate.manage && role, seeAll: gate.readAll && role };
}
type Gate = Awaited<ReturnType<typeof okrAccess>>;

/**
 * 남의 목표에 굳어 있는 근거(업무 문서 제목 · 수업보고서)는 그 원본을 열 권한이 있을 때만 싣는다(#77 — 건수 문장은 남는다). 본인 목표는 그대로.
 * 🔴 목록·이력 응답이 **같은 함수**를 지난다 — 한쪽만 거르면 다른 쪽으로 샌다(Codex 검토: 이력 GET이 저장된 document를 그대로 돌려줬다).
 */
async function refVisibility(gate: Gate) {
  const [seeWork, seeLessons] = await Promise.all([
    workAccess().then(g => g.seeReview, () => false),
    Promise.all([canAccessTenant(gate.user.systemRole, "lesson_reports"), canAccessTenant(gate.user.systemRole, "teacher_onescreen")]).then(v => v.some(Boolean)),
  ]);
  return <D extends Pick<OkrDocument, "krs">>(ownerId: string, d: D): D =>
    ownerId === gate.user.id || (seeWork && seeLessons) ? d : { ...d, krs: (d.krs ?? []).map(k => ({ ...k, refs: (k.refs ?? []).filter(e => e.kind === "work" ? seeWork : seeLessons) })) };
}

export async function loadOkrWorkspace() {
  const gate = await okrAccess(), db = createAdminClient(), tenant = gate.user.tenantId;
  const [loaded, sharedRaw, visible] = await Promise.all([
    fetchAllPaged<OkrRecord>((a, b) => { let q = db.from("organization_okr").select(fields).eq("tenant_id", tenant); if (!gate.seeAll) q = q.eq("owner_id", gate.user.id); return q.order("updated_at", { ascending: false }).order("id").range(a, b); }),
    // 직원에게 공유하는 것은 '실행 중' 조직·팀 목표의 요약뿐 — 개인 근거·피드백은 담당자와 관리자에게만.
    fetchAllPaged<OkrRecord>((a, b) => db.from("organization_okr").select(fields).eq("tenant_id", tenant).eq("document->>state", "active").in("document->>scope", ["organization", "team"]).order("id").range(a, b)),
    refVisibility(gate),
  ]);
  const rows = loaded.map(r => ({ ...r, document: visible(r.owner_id, r.document) }));
  const shared = sharedRaw.map(r => ({ id: r.id, ownerId: r.owner_id, title: r.document.title, scope: r.document.scope, from: r.document.from, through: r.document.through, team: r.document.team, parentId: r.document.parentId, krs: r.document.krs.map(k => ({ title: k.title, actual: k.actual, target: k.target, unit: k.unit, measuredOn: k.measuredOn })) }));
  const ids = [...new Set([gate.user.id, ...rows.map(r => r.owner_id), ...rows.flatMap(r => r.review ? [r.review.reviewerId] : []), ...shared.map(r => r.ownerId)])];
  const users = await fetchInChunks<{ id: string; display_name: string }>(ids, (chunk) => db.from("users").select("id,display_name").eq("tenant_id", tenant).in("id", chunk));
  const names: Record<string, string> = Object.fromEntries(users.map(u => [u.id, u.display_name]));
  const graph = okrGraph(rows.filter(r => r.document.state !== "archived"), names);
  for (const g of shared) {
    const id = `okr:${g.id}`, staff = `staff:${g.ownerId}`;
    if (!graph.nodes.some(n => n.id === id)) graph.nodes.push({ id, type: "Objective", label: g.title, state: "active", period: `${g.from}~${g.through}`, detail: "직원에게 공개된 조직·팀 목표 요약" });
    if (!graph.nodes.some(n => n.id === staff)) graph.nodes.push({ id: staff, type: "Staff", label: names[g.ownerId] ?? "담당자" });
    if (!graph.edges.some(e => e.from === id && e.to === staff)) graph.edges.push({ from: id, to: staff, relation: "ASSIGNED_TO", basis: "공개 목표 담당자" });
  }
  for (const g of [...rows.map(r => ({ id: r.id, parentId: r.document.parentId })), ...shared])
    if (g.parentId && graph.nodes.some(n => n.id === `okr:${g.id}`) && graph.nodes.some(n => n.id === `okr:${g.parentId}`) && !graph.edges.some(e => e.from === `okr:${g.id}` && e.to === `okr:${g.parentId}`))
      graph.edges.push({ from: `okr:${g.id}`, to: `okr:${g.parentId}`, relation: "ALIGNS_WITH", basis: "공개된 상위 목표와의 명시 연결" });
  return { rows, shared, names, actorId: gate.user.id, writable: gate.writable, manager: gate.manager, today: kstToday(), graph };
}
export type OkrWorkspaceData = Awaited<ReturnType<typeof loadOkrWorkspace>>;

async function accessibleRecord(id: string, gate: Gate) {
  const { data, error } = await createAdminClient().from("organization_okr").select(fields).eq("tenant_id", gate.user.tenantId).eq("id", z.uuid().parse(id)).maybeSingle();
  if (error || !data || (data.owner_id !== gate.user.id && !gate.seeAll)) throw Error("목표 또는 열람 권한을 확인해 주세요");
  return data as OkrRecord;
}
export async function okrHistory(id: string) {
  const gate = await okrAccess();
  const [record, visible] = await Promise.all([accessibleRecord(id, gate), refVisibility(gate)]);
  const { data, error } = await createAdminClient().from("organization_okr_revisions").select("version,action,document,review,recorded_at,actor_id").eq("tenant_id", gate.user.tenantId).eq("record_id", id).order("version", { ascending: false }).limit(50);
  if (error) throw Error("이력을 불러오지 못했습니다");
  // 검토(review) 이력의 document는 null일 수 있다 — 있는 것만 거른다.
  return (data ?? []).map(h => h.document ? { ...h, document: visible(record.owner_id, h.document as OkrDocument) } : h);
}

/** 핵심결과의 '업무 문서'·'수업보고서' 근거 — 담당자 ID로 센다(이름으로 잇지 않는다). 그 원본을 열 권한이 있어야 한다. */
async function sourceEvidence(d: OkrDocument, gate: Gate) {
  const db = createAdminClient(), out: Evidence[] = [], through = d.through < kstToday() ? d.through : kstToday();
  if (d.krs.some(k => k.source === "work")) {
    if (!await canAccessTenant(gate.user.systemRole, "work_records")) throw Error("업무 작성센터 열람 권한이 필요합니다");
    const rows = await fetchAllPaged<{ id: string; version: number; document: { title: string; date: string } }>((a, b) => db.from("academy_work_records").select("id,version,document").eq("tenant_id", gate.user.tenantId).eq("author_id", d.ownerId).in("document->>state", ["submitted", "reviewed"]).gte("document->>date", d.from).lte("document->>date", through).order("id").range(a, b));
    for (const r of rows) out.push({ kind: "work", id: r.id, version: r.version, date: r.document.date, label: r.document.title, href: `/work-records?record=${r.id}` });
  }
  if (d.krs.some(k => k.source === "lessons")) {
    if (!await canAccessTenant(gate.user.systemRole, "teacher_onescreen") && !await canAccessTenant(gate.user.systemRole, "lesson_reports")) throw Error("수업 기록 열람 권한이 필요합니다");
    const rows = await fetchAllPaged<{ id: string; report_date: string }>((a, b) => db.from("lesson_reports").select("id,report_date").eq("tenant_id", gate.user.tenantId).eq("created_by", d.ownerId).is("revoked_at", null).gte("report_date", d.from).lte("report_date", through).order("id").range(a, b));
    for (const r of rows) out.push({ kind: "lessons", id: r.id, version: null, date: r.report_date, label: `${r.report_date} 담당자 작성 수업보고서`, href: gate.user.systemRole === "teacher" ? "/onescreen" : "/lesson-reports" });
  }
  return out;
}

export async function saveOkr(raw: unknown) {
  const input = requestSchema.parse(raw), gate = await okrAccess();
  if (!gate.writable) throw Error("열람 전용입니다. 작성 권한을 확인해 주세요");
  const db = createAdminClient(), existing = await db.from("organization_okr").select(fields).eq("tenant_id", gate.user.tenantId).eq("id", input.id).maybeSingle();
  if (existing.error) throw Error("목표 조회에 실패했습니다");
  const old = existing.data as OkrRecord | null;
  if ((old?.version ?? 0) !== input.version) throw Error("다른 변경이 있습니다. 새로 불러와 주세요");
  let document: OkrDocument | null = null;
  if (input.action === "review") {
    if (!gate.manager || !old || old.owner_id === gate.user.id || !input.note || input.note.length < 2 || !input.verdict) throw Error("다른 담당자의 목표에 피드백을 작성해 주세요");
  } else {
    if (!input.document) throw Error("목표 내용을 입력해 주세요");
    const base = input.document;
    assertSave(old, base, gate.user.id, gate.manager);
    const refs = await sourceEvidence(base, gate), today = kstToday(), asOf = base.through < today ? base.through : today;
    // 실적은 저장하는 순간 서버가 다시 센다(화면이 보낸 값을 믿지 않는다) — 수동 KR만 담당자 입력값.
    document = { ...base, krs: base.krs.map(k => {
      if (k.source === "manual") return { ...k, refs: [] };
      const tasks = base.tasks.filter(t => t.krId === k.id), found = refs.filter(e => e.kind === k.source), future = base.from > today, done = tasks.filter(t => t.status === "done").length;
      const actual = future ? null : k.source === "tasks" ? (tasks.length ? Math.round(done / tasks.length * 10000) / 100 : null) : found.length;
      return { ...k, actual, measuredOn: actual === null ? null : asOf, evidence: actual === null ? "아직 측정할 대상이 없습니다" : k.source === "tasks" ? `완료 ${done} / 전체 ${tasks.length} 과제 · 저장 시점` : `${base.from}~${asOf} · 담당자 ID로 확인한 ${found.length}건 · 저장 시점`, refs: found.slice(0, 100) };
    }) };
    let parent: OkrRecord | undefined;
    if (document.parentId) {
      const p = await db.from("organization_okr").select(fields).eq("tenant_id", gate.user.tenantId).eq("id", document.parentId).in("document->>scope", ["organization", "team"]).eq("document->>state", "active").maybeSingle();
      if (p.error) throw Error("상위 목표를 확인하지 못했습니다");
      parent = (p.data as OkrRecord | null) ?? undefined;
    }
    validateGoal(document, today, parent);
  }
  const saved = await db.rpc("save_organization_okr", { p_tenant: gate.user.tenantId, p_actor: gate.user.id, p_id: input.id, p_expected: input.version, p_action: input.action, p_document: document, p_note: input.note ?? "", p_verdict: input.verdict ?? "" });
  if (saved.error) {
    console.error("[organization-okr] save", saved.error.code, saved.error.message);
    throw Error(saved.error.code === "40001" ? "다른 변경이 있습니다. 새로 불러와 주세요" : saved.error.message.includes("하위 목표") ? "진행 중인 하위 목표를 먼저 점검해 주세요" : "저장하지 못했습니다. 담당자·목표 상태를 확인해 주세요");
  }
  return saved.data as number;
}
