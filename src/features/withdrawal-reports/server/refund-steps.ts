import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { missingReportSchema, type RefundStep, type StaffOption } from "../model";

/**
 * 보고서 묶음의 데스크 환불 단계(원장 2026-11-03 · s2_0025 `withdrawal_report_refunds`) — 묶음 id(옛 단건은 보고서 id) → 단계 목록.
 * 완료 = 환불 요청서의 환불완료일자. 지워진 요청서는 뺀다(DB `withdrawal_report_refund_pending`과 같은 판정 — 더는 기다릴 환불이 아니다).
 * 담당 이름 = 직원 목록 → 없으면 요청서 결재칸 '담당' → '데스크'. 요청서 본문(계좌 등)은 읽지 않는다(완료일·담당 이름 두 칸만).
 * 표가 없는 DB(s2_0025 전)는 빈 목록 — 화면은 종전 그대로(#95).
 */
export async function loadRefundSteps(tenantId: string, keys: { id: string; group_id?: string | null }[], staff: readonly Pick<StaffOption, "id" | "name">[] = []): Promise<Map<string, RefundStep[]>> {
  const out = new Map<string, RefundStep[]>();
  const groupIds = [...new Set(keys.map(k => k.group_id).filter((g): g is string => !!g))];
  const reportIds = [...new Set(keys.filter(k => !k.group_id).map(k => k.id))];
  if (!groupIds.length && !reportIds.length) return out;
  const db = createAdminClient();
  type Link = { report_id: string; group_id: string | null; document_id: string; desk_id: string | null; created_at: string };
  const read = async (column: "group_id" | "report_id", ids: string[]) => !ids.length ? [] as Link[] : fetchInChunks<Link>(ids, async chunk => {
    const res = await db.from("withdrawal_report_refunds").select("report_id,group_id,document_id,desk_id,created_at").eq("tenant_id", tenantId).in(column, chunk).order("created_at");
    if (missingReportSchema(res.error)) return { data: [], error: null };
    return res as unknown as { data: Link[] | null; error: { message: string } | null };
  });
  const links = [...await read("group_id", groupIds), ...await read("report_id", reportIds)];
  if (!links.length) return out;
  const docs = await fetchInChunks<{ id: string; completed: string | null; desk: string | null }>([...new Set(links.map(l => l.document_id))], async chunk =>
    (await db.from("academy_documents").select("id,completed:form_data->result->>completedDate,desk:form_data->approval->>staff")
      .eq("tenant_id", tenantId).eq("form_type", "refund_request").in("id", chunk)) as unknown as { data: { id: string; completed: string | null; desk: string | null }[] | null; error: { message: string } | null });
  const byDoc = new Map(docs.map(d => [String(d.id), d]));
  // 데스크 담당의 이름·직급·재직 — 승인 진행 '○ 홍길동 대리'(원장 2026-11-06). 회계 등은 퇴원보고서 직원 목록(`staff`)에 없어 따로 읽는다. 못 읽으면 종전 이름만.
  type Desk = { id: string; display_name: string | null; job_title: string | null; status: string };
  const deskIds = [...new Set(links.flatMap(l => l.desk_id ? [l.desk_id] : []))];
  const desks = new Map((deskIds.length ? await fetchInChunks<Desk>(deskIds, async chunk =>
    (await db.from("users").select("id,display_name,job_title,status").eq("tenant_id", tenantId).in("id", chunk)) as unknown as { data: Desk[] | null; error: { message: string } | null })
    .catch((e: unknown) => { console.error("[withdrawal-report-refund-steps] 데스크 담당 조회 실패", e); return [] as Desk[]; }) : []).map(u => [String(u.id), u]));
  for (const l of links) {
    const doc = byDoc.get(String(l.document_id));
    if (!doc) continue;
    const key = l.group_id ?? l.report_id;
    const user = l.desk_id ? desks.get(l.desk_id) : undefined;
    const deskName = user?.display_name?.trim() || staff.find(s => s.id === l.desk_id)?.name || (doc.desk?.trim() || "데스크");
    out.set(key, [...(out.get(key) ?? []), { documentId: String(l.document_id), deskId: l.desk_id, deskName, completedDate: doc.completed?.trim() || null,
      ...(user ? { deskTitle: user.job_title?.trim() || null, deskActive: user.status === "active" } : {}) }]);
  }
  return out;
}

/**
 * 이 환불 요청서가 퇴원보고서에 이어졌나(s2_0025 `withdrawal_report_refunds`) — 이어졌으면 데스크 담당(id · 이름). 이어지지 않았거나 표가 없는 DB면 null.
 * 원장 2026-11-06: 이어진 요청서의 환불완료일자는 그 데스크 담당과 원장급만 넣거나 지운다(`canEditLinkedCompletion` · DB 트리거 s2_0033). 못 읽으면 던진다.
 */
export async function loadRefundLink(tenantId: string, documentId: string): Promise<{ deskId: string | null; deskName: string | null; superseded: boolean } | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_report_refunds").select("desk_id,report_id").eq("tenant_id", tenantId).eq("document_id", documentId).maybeSingle();
  if (missingReportSchema(error)) return null;
  if (error) throw new Error(`환불 요청서의 퇴원보고서 연결 조회 실패: ${error.message}`);
  if (!data) return null;
  const row = data as { desk_id: string | null; report_id: string };
  const superseded = await supersededByNewRequest(db, tenantId, documentId, String(row.report_id));
  const deskId = row.desk_id;
  if (!deskId) return { deskId: null, deskName: null, superseded };
  const { data: user } = await db.from("users").select("display_name").eq("tenant_id", tenantId).eq("id", deskId).maybeSingle();
  return { deskId, deskName: (user as { display_name: string | null } | null)?.display_name?.trim() || null, superseded };
}

/**
 * 원장 결정(2026-11-06 · C.3) — 이 요청서가 **취소된 요청에만** 이어졌고, 같은 청구 줄을 담은 **새 퇴원 요청의 요청서**(취소되지 않은 묶음 · 문서가 남음)가
 * 있나. 있으면 환불완료일자를 넣을 수 없다(DB 완료일자 트리거와 같은 판정 — 줄 겹침 = 같은 청구 · 같은 식별값(차례 번호 뺀) 또는 청구 전체).
 * 화면은 칸을 잠그고 사유를 보인다 · 저장 액션도 같은 판정으로 먼저 막는다. 못 읽으면 던진다(부르는 쪽이 잠근다).
 */
async function supersededByNewRequest(db: ReturnType<typeof createAdminClient>, tenantId: string, documentId: string, reportId: string): Promise<boolean> {
  const { data: rep, error: repError } = await db.from("withdrawal_reports").select("status").eq("tenant_id", tenantId).eq("id", reportId).maybeSingle();
  if (repError) throw new Error(`환불 요청서의 보고서 상태 조회 실패: ${repError.message}`);
  if ((rep as { status?: string } | null)?.status !== "canceled") return false;
  const { data: mine, error: mineError } = await db.from("withdrawal_report_refund_decisions").select("line_key").eq("tenant_id", tenantId).eq("document_id", documentId).eq("decision", "refund").limit(200);
  if (missingReportSchema(mineError) || mineError?.code === "42703") return false;
  if (mineError) throw new Error(`환불 결정 조회 실패: ${mineError.message}`);
  const keys = (mine ?? []).map(r => String(r.line_key));
  if (!keys.length) return false;
  const invoices = [...new Set(keys.map(k => k.split("#")[0]!))];
  const { data: others, error: othersError } = await db.from("withdrawal_report_refund_decisions").select("line_key,document_id,group_id")
    .eq("tenant_id", tenantId).eq("decision", "refund").neq("document_id", documentId).or(invoices.map(i => `line_key.like.${i}#*`).join(",")).limit(500);
  if (othersError) throw new Error(`환불 결정 조회 실패: ${othersError.message}`);
  const base = (k: string) => (k.split("#")[1] ?? "").replace(/-\d+$/, "");
  const overlaps = (a: string, b: string) => a.split("#")[0] === b.split("#")[0] && (base(a) === "all" || base(b) === "all" || base(a) === base(b));
  const hits = (others ?? []).filter(o => keys.some(k => overlaps(k, String(o.line_key))));
  if (!hits.length) return false;
  const [{ data: groups, error: gError }, { data: docs, error: dError }] = await Promise.all([
    db.from("withdrawal_report_groups").select("id,status").eq("tenant_id", tenantId).in("id", [...new Set(hits.map(h => String(h.group_id)))]),
    db.from("academy_documents").select("id").eq("tenant_id", tenantId).eq("form_type", "refund_request").in("id", [...new Set(hits.map(h => String(h.document_id)))]),
  ]);
  if (gError || dError) throw new Error(`새 요청서 확인 실패: ${(gError ?? dError)!.message}`);
  const liveGroups = new Set((groups ?? []).filter(g => g.status !== "canceled").map(g => String(g.id)));
  const liveDocs = new Set((docs ?? []).map(d => String(d.id)));
  return hits.some(h => liveGroups.has(String(h.group_id)) && liveDocs.has(String(h.document_id)));
}
