import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { missingReportSchema, type RefundStep, type StaffOption } from "../model";
import { keysOverlap } from "../refund-keys";

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

/** 이어진 요청서 한 장의 사정(수납 화면 잠금·상한·삭제 — 원장 결정 2026-11-06·11-09 · 리뷰 r2 I4·I6·B1). */
export type RefundLink = {
  deskId: string | null; deskName: string | null;
  /** 담당 데스크가 재직 중인가(퇴사면 완료·수정·삭제 모두 원장만 — DB 트리거와 같다). 모르면 true. */
  deskActive: boolean;
  /** 원장 결정 C.3 — 이 요청서는 새 퇴원 요청의 요청서로 대체됐다(완료일자 입력 불가 · 환불하지 말 것). */
  superseded: boolean;
  /** 대체한 새 요청서와 그 담당(있으면 · 화면 경고의 링크). */
  supersededBy: { documentId: string; deskName: string | null } | null;
  /** 상한 = 원장이 이 요청서로 환불 승인한 줄의 낸 돈 합(결정 표 paid_net — '환불 없음'으로 정한 늘어난 몫은 들지 않는다) · 모르면 null(옛 연결 · paid_net 없음). */
  cap: number | null;
  /** 원장 승인 줄 수(상한 표시 'N건'). */
  capLines: number;
};

/**
 * 이 환불 요청서가 퇴원보고서에 이어졌나(s2_0025 `withdrawal_report_refunds`) — 이어졌으면 데스크 담당 · 대체 여부 · 상한. 이어지지 않았거나 표가 없는 DB면 null.
 * 원장 2026-11-06·11-09: 이어진 요청서의 환불완료일자·수정·삭제는 그 데스크 담당(재직)과 원장급만(`linked-request.ts` · DB 트리거 s2_0036). 못 읽으면 던진다.
 */
export async function loadRefundLink(tenantId: string, documentId: string): Promise<RefundLink | null> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_report_refunds").select("desk_id,report_id").eq("tenant_id", tenantId).eq("document_id", documentId).maybeSingle();
  if (missingReportSchema(error)) return null;
  if (error) throw new Error(`환불 요청서의 퇴원보고서 연결 조회 실패: ${error.message}`);
  if (!data) return null;
  const row = data as { desk_id: string | null; report_id: string };
  const [by, cap] = await Promise.all([supersedingRequest(db, tenantId, documentId, String(row.report_id)), linkedCap(db, tenantId, documentId)]);
  const desk = row.desk_id ? await deskOf(db, tenantId, row.desk_id) : null;
  return { deskId: row.desk_id, deskName: desk?.name ?? null, deskActive: desk ? desk.active : true, superseded: !!by, supersededBy: by, ...cap };
}

async function deskOf(db: ReturnType<typeof createAdminClient>, tenantId: string, userId: string): Promise<{ name: string | null; active: boolean } | null> {
  const { data, error } = await db.from("users").select("display_name,status").eq("tenant_id", tenantId).eq("id", userId).maybeSingle();
  if (error) throw new Error(`데스크 담당 조회 실패: ${error.message}`);
  const u = data as { display_name: string | null; status: string } | null;
  // 사람이 없으면(지움) 퇴사와 같게 — 담당 데스크 몫이 없다(원장만).
  return u ? { name: u.display_name?.trim() || null, active: u.status === "active" } : { name: null, active: false };
}

/** 상한(리뷰 r2 I6) — 이 요청서의 '환불' 결정 행 paid_net 합. 행이 없거나 하나라도 비면 모름(null). 결정 표가 없는 DB면 모름. */
async function linkedCap(db: ReturnType<typeof createAdminClient>, tenantId: string, documentId: string): Promise<{ cap: number | null; capLines: number }> {
  const { data, error } = await db.from("withdrawal_report_refund_decisions").select("paid_net").eq("tenant_id", tenantId).eq("document_id", documentId).eq("decision", "refund").limit(200);
  if (missingReportSchema(error) || error?.code === "42703") return { cap: null, capLines: 0 };
  if (error) throw new Error(`환불 결정 조회 실패: ${error.message}`);
  const rows = (data ?? []) as { paid_net: number | string | null }[];
  if (!rows.length || rows.some(r => r.paid_net == null || !Number.isFinite(Number(r.paid_net)))) return { cap: null, capLines: rows.filter(r => Number(r.paid_net) > 0).length };
  return { cap: rows.reduce((s, r) => s + Number(r.paid_net), 0), capLines: rows.filter(r => Number(r.paid_net) > 0).length };
}

/**
 * 원장 결정(2026-11-06 · C.3) — 이 요청서가 **취소된 요청에만** 이어졌고, 그 돈을 다시 담은 **새 퇴원 요청의 요청서**(취소되지 않은 묶음 · 문서가 남음)가 있나.
 * 있으면 환불완료일자를 넣을 수 없다(DB 완료일자 트리거와 같은 판정 — 줄 키 겹침 규칙 `keysOverlap` 한 벌 · 또는 새 결정 행이 이 요청서를 대체한다고 적음(supersedes ·
 * 수납명이 바뀌어 키가 달라도 맞다 — 리뷰 r2 D-1 ⅰ)). 화면은 경고하고 칸을 잠근다 · 저장 액션도 같은 판정으로 먼저 막는다. 못 읽으면 던진다(부르는 쪽이 잠근다).
 */
async function supersedingRequest(db: ReturnType<typeof createAdminClient>, tenantId: string, documentId: string, reportId: string): Promise<{ documentId: string; deskName: string | null } | null> {
  const { data: rep, error: repError } = await db.from("withdrawal_reports").select("status").eq("tenant_id", tenantId).eq("id", reportId).maybeSingle();
  if (repError) throw new Error(`환불 요청서의 보고서 상태 조회 실패: ${repError.message}`);
  if ((rep as { status?: string } | null)?.status !== "canceled") return null;
  const { data: mine, error: mineError } = await db.from("withdrawal_report_refund_decisions").select("line_key").eq("tenant_id", tenantId).eq("document_id", documentId).eq("decision", "refund").limit(200);
  if (missingReportSchema(mineError) || mineError?.code === "42703") return null;
  if (mineError) throw new Error(`환불 결정 조회 실패: ${mineError.message}`);
  const keys = (mine ?? []).map(r => String(r.line_key));
  const invoices = [...new Set(keys.map(k => k.split("#")[0]!))];
  type Row = { line_key: string; document_id: string; group_id: string };
  const [{ data: named, error: namedError }, { data: byKey, error: byKeyError }] = await Promise.all([
    db.from("withdrawal_report_refund_decisions").select("line_key,document_id,group_id").eq("tenant_id", tenantId).eq("decision", "refund").neq("document_id", documentId).contains("supersedes", [documentId]).limit(200),
    invoices.length
      ? db.from("withdrawal_report_refund_decisions").select("line_key,document_id,group_id").eq("tenant_id", tenantId).eq("decision", "refund").neq("document_id", documentId).or(invoices.map(i => `line_key.like.${i}#*`).join(",")).limit(500)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (namedError || byKeyError) throw new Error(`환불 결정 조회 실패: ${(namedError ?? byKeyError)!.message}`);
  const hits = [...((named ?? []) as Row[]), ...((byKey ?? []) as Row[]).filter(o => keys.some(k => keysOverlap(k, String(o.line_key))))];
  if (!hits.length) return null;
  const [{ data: groups, error: gError }, { data: docs, error: dError }] = await Promise.all([
    db.from("withdrawal_report_groups").select("id,status").eq("tenant_id", tenantId).in("id", [...new Set(hits.map(h => String(h.group_id)))]),
    db.from("academy_documents").select("id").eq("tenant_id", tenantId).eq("form_type", "refund_request").in("id", [...new Set(hits.map(h => String(h.document_id)))]),
  ]);
  if (gError || dError) throw new Error(`새 요청서 확인 실패: ${(gError ?? dError)!.message}`);
  const liveGroups = new Set((groups ?? []).filter(g => g.status !== "canceled").map(g => String(g.id)));
  const liveDocs = new Set((docs ?? []).map(d => String(d.id)));
  const hit = hits.find(h => liveGroups.has(String(h.group_id)) && liveDocs.has(String(h.document_id)));
  if (!hit) return null;
  // 새 요청서의 담당(경고 '새 요청서 · 담당 ○○') — 못 읽으면 이름 없이.
  const { data: link } = await db.from("withdrawal_report_refunds").select("desk_id").eq("tenant_id", tenantId).eq("document_id", hit.document_id).maybeSingle();
  const deskId = (link as { desk_id?: string | null } | null)?.desk_id ?? null;
  const desk = deskId ? await deskOf(db, tenantId, deskId).catch(() => null) : null;
  return { documentId: String(hit.document_id), deskName: desk?.name ?? null };
}
