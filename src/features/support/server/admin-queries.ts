import "server-only";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { cleanSearch, searchFilter } from "../missing";
import {
  asSupportStatus,
  type SupportList,
  type SupportLoad,
  type SupportNoticeDetail,
  type SupportRequestDetail,
  type SupportRequestListItem,
  type SupportStatus,
} from "../types";
import { listFailure, loadFailure, loadNames, toRequestDetail } from "./queries";

/**
 * 슈퍼관리자 전 지점 조회 — service_role(RLS 우회). 🔴 **맨 앞에서 `requireSuperAdmin()`** — 이 파일의 함수가
 * 다른 화면에서 불려도 게이트가 따라간다([[#77]]: 화면에서만 잠그면 우회 폭).
 */
export async function getAllSupportRequestsPage(opts: {
  q?: string;
  status?: SupportStatus | null;
  tenantId?: string | null;
  page: number;
  pageSize: number;
}): Promise<SupportList<SupportRequestListItem>> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const from = (opts.page - 1) * opts.pageSize;
  let qb = admin
    .from("support_requests")
    .select("id, tenant_id, title, status, author_id, created_at, due_date", { count: "exact" });
  const q = cleanSearch(opts.q);
  if (q) qb = qb.or(searchFilter(q));
  if (opts.status) qb = qb.eq("status", opts.status);
  if (opts.tenantId) qb = qb.eq("tenant_id", opts.tenantId);
  const { data, error, count } = await qb
    .order("created_at", { ascending: false })
    .range(from, from + opts.pageSize - 1);
  if (error) return listFailure(error, "support.admin.list", "개선요청을 불러오지 못했습니다");
  const rows = data ?? [];
  const total = count ?? 0;
  const [names, tenants] = await Promise.all([
    loadNames(admin, rows.map((r) => r.author_id as string)).catch(() => new Map<string, string>()),
    loadTenantNames(admin, rows.map((r) => r.tenant_id as string)).catch(() => new Map<string, string>()),
  ]);
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
      tenantName: tenants.get(r.tenant_id as string) ?? "알 수 없는 지점",
    })),
  };
}

export async function getAnySupportRequest(id: string): Promise<SupportLoad<SupportRequestDetail>> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_requests")
    .select(
      "id, tenant_id, title, body, contact_phone, contact_email, status, due_date, answer, answered_at, author_id, created_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return loadFailure(error, "support.admin.detail", "글을 불러오지 못했습니다");
  if (!data) return { ready: true, item: null };
  const [names, tenants] = await Promise.all([
    loadNames(admin, [data.author_id as string]).catch(() => new Map<string, string>()),
    loadTenantNames(admin, [data.tenant_id as string]).catch(() => new Map<string, string>()),
  ]);
  return {
    ready: true,
    item: {
      ...toRequestDetail(data, names.get(data.author_id as string) ?? "직원"),
      tenantName: tenants.get(data.tenant_id as string) ?? "알 수 없는 지점",
    },
  };
}

/** 처리상태별 건수 — 대기 중인 일을 한눈에(`count: exact, head: true`, B2). */
export async function getSupportStatusCounts(): Promise<Record<SupportStatus, number> | null> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const statuses: SupportStatus[] = ["received", "checking", "in_progress", "done"];
  const results = await Promise.all(
    statuses.map((s) =>
      admin.from("support_requests").select("*", { count: "exact", head: true }).eq("status", s),
    ),
  );
  if (results.some((r) => r.error)) return null;
  return Object.fromEntries(statuses.map((s, i) => [s, results[i].count ?? 0])) as Record<SupportStatus, number>;
}

export async function getAnySupportNotice(id: string): Promise<SupportLoad<SupportNoticeDetail>> {
  await requireSuperAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("support_notices")
    .select("id, title, body, pinned, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return loadFailure(error, "support.admin.notice", "공지를 불러오지 못했습니다");
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

async function loadTenantNames(
  admin: ReturnType<typeof createAdminClient>,
  ids: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const rows = await fetchInChunks(uniq, (chunk) => admin.from("tenants").select("id, name").in("id", chunk));
  return new Map(rows.map((t) => [t.id as string, (t.name as string) || "이름 없는 지점"]));
}
