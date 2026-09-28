import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { cleanSearch, isMissingSupportTables, searchFilter } from "../missing";
import {
  asSupportStatus,
  type SupportList,
  type SupportLoad,
  type SupportNoticeDetail,
  type SupportNoticeListItem,
  type SupportRequestDetail,
  type SupportRequestListItem,
  type SupportStatus,
} from "../types";

type Supa = Awaited<ReturnType<typeof createClient>>;

const REQUEST_LIST_COLS = "id, title, status, author_id, created_at, due_date";

/**
 * 지점 화면 조회 — **세션 클라이언트**(RLS: 개선요청은 자기 지점만, 공지는 전원). 슈퍼관리자 전 지점 조회는
 * [`admin-queries.ts`](./admin-queries.ts)가 따로 한다(여기에 service_role을 섞지 말 것).
 */
export async function getSupportRequestsPage(opts: {
  q?: string;
  status?: SupportStatus | null;
  page: number;
  pageSize: number;
}): Promise<SupportList<SupportRequestListItem>> {
  const supabase = await createClient();
  const from = (opts.page - 1) * opts.pageSize;
  let qb = supabase.from("support_requests").select(REQUEST_LIST_COLS, { count: "exact" });
  const q = cleanSearch(opts.q);
  if (q) qb = qb.or(searchFilter(q));
  if (opts.status) qb = qb.eq("status", opts.status);
  const { data, error, count } = await qb
    .order("created_at", { ascending: false })
    .range(from, from + opts.pageSize - 1);
  if (error) return listFailure(error, "support.requests.list", "개선요청을 불러오지 못했습니다");
  const rows = data ?? [];
  const total = count ?? 0;
  const names = await loadNames(supabase, rows.map((r) => r.author_id as string)).catch(
    () => new Map<string, string>(),
  );
  return {
    ready: true,
    total,
    rows: rows.map((r, i) => ({
      id: r.id as string,
      no: total - from - i,
      title: r.title as string,
      status: asSupportStatus(r.status),
      authorName: names.get(r.author_id as string) ?? "직원",
      createdAt: r.created_at as string,
      dueDate: (r.due_date as string | null) ?? null,
    })),
  };
}

export async function getSupportRequest(id: string): Promise<SupportLoad<SupportRequestDetail>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_requests")
    .select(
      "id, tenant_id, title, body, contact_phone, contact_email, status, due_date, answer, answered_at, author_id, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return loadFailure(error, "support.requests.detail", "글을 불러오지 못했습니다");
  if (!data) return { ready: true, item: null };
  const names = await loadNames(supabase, [data.author_id as string]).catch(() => new Map<string, string>());
  return { ready: true, item: toRequestDetail(data, names.get(data.author_id as string) ?? "직원") };
}

export async function getSupportNoticesPage(opts: {
  q?: string;
  page: number;
  pageSize: number;
}): Promise<SupportList<SupportNoticeListItem> & { pinnedTotal: number }> {
  const supabase = await createClient();
  const from = (opts.page - 1) * opts.pageSize;
  const q = cleanSearch(opts.q);
  let qb = supabase.from("support_notices").select("id, title, pinned, created_at", { count: "exact" });
  // 고정 공지 수 — 일반 공지 번호(No)를 역순으로 매기는 재료. 같은 검색 조건으로 센다(B2: 행은 안 받는다).
  let pinnedQb = supabase.from("support_notices").select("*", { count: "exact", head: true }).eq("pinned", true);
  if (q) {
    qb = qb.or(searchFilter(q));
    pinnedQb = pinnedQb.or(searchFilter(q));
  }
  const [{ data, error, count }, pinned] = await Promise.all([
    qb
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, from + opts.pageSize - 1),
    pinnedQb,
  ]);
  if (error) {
    return { ...listFailure<SupportNoticeListItem>(error, "support.notices.list", "공지사항을 불러오지 못했습니다"), pinnedTotal: 0 };
  }
  return {
    ready: true,
    total: count ?? 0,
    pinnedTotal: pinned.count ?? 0,
    rows: (data ?? []).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      pinned: Boolean(r.pinned),
      createdAt: r.created_at as string,
    })),
  };
}

export async function getSupportNotice(id: string): Promise<SupportLoad<SupportNoticeDetail>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_notices")
    .select("id, title, body, pinned, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return loadFailure(error, "support.notices.detail", "공지를 불러오지 못했습니다");
  if (!data) return { ready: true, item: null };
  return {
    ready: true,
    item: {
      id: data.id as string,
      title: data.title as string,
      body: data.body as string,
      pinned: Boolean(data.pinned),
      createdAt: data.created_at as string,
    },
  };
}

// ── 공용 조각(admin-queries도 쓴다) ──

export function toRequestDetail(r: Record<string, unknown>, authorName: string): SupportRequestDetail {
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    title: r.title as string,
    body: r.body as string,
    contactPhone: (r.contact_phone as string | null) ?? null,
    contactEmail: (r.contact_email as string | null) ?? null,
    status: asSupportStatus(r.status),
    dueDate: (r.due_date as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
    answeredAt: (r.answered_at as string | null) ?? null,
    authorId: r.author_id as string,
    authorName,
    createdAt: r.created_at as string,
  };
}

export function listFailure<T>(
  error: { code?: string; message: string },
  scope: string,
  summary: string,
): SupportList<T> {
  if (isMissingSupportTables(error)) return { ready: false, rows: [], total: 0 };
  reportError(error, { scope });
  return { ready: false, rows: [], total: 0, error: { summary, raw: error.message } };
}

export function loadFailure<T>(
  error: { code?: string; message: string },
  scope: string,
  summary: string,
): SupportLoad<T> {
  if (isMissingSupportTables(error)) return { ready: false, missingTable: true };
  reportError(error, { scope });
  return { ready: false, missingTable: false, error: { summary, raw: error.message } };
}

export async function loadNames(supabase: Pick<Supa, "from">, ids: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await fetchInChunks(uniq, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  return new Map(rows.map((u) => [u.id as string, (u.display_name as string) || "직원"]));
}
