import "server-only";
/**
 * '지난 의견' 목록 읽기(제안 → 결과 → 학습 3단계 첫 조각 · 2026-11-10) — 본인 의견 전부 + 그 답의 대화 이름. 지운 대화의 의견은 뺀다.
 * 앱의 관리자 연결(service_role)로만 읽는다(표는 RLS 켬 · 정책 0 — 원장 관문 `assistantViewer`를 지난 뒤에만 부른다).
 * 🔴 의견은 답마다 쌓이므로 전건 페이징(`fetchAllPaged` + id 정렬 — 1,000행 침묵 절단 금지, B2). 대화도 본인 것 전부(사이드바 100개 한도와 따로).
 * AI는 부르지 않는다.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { ADVICE_VIEW_COLUMNS, adviceViewOf, type AdviceRow } from "../advice";
import type { AdviceListItem } from "../advice-list";
import { ADVICE } from "./advice-store";
import { covers } from "../scope";
import { THREADS, type Owner, type ViewerScope } from "./store";

type ListRow = AdviceRow & { thread_id: string; action: string; why: string; created_at: string; scope_keys: string[] | null };

/** `scope` = 지금 권한 범위 — 덮지 못하는 의견(권한이 줄었다 · 표지 없는 옛 의견은 원장만)은 목록에서 뺀다(Codex 합의 9). */
export async function listAdvice(owner: Owner, scope: ViewerScope): Promise<AdviceListItem[]> {
  const db = createAdminClient();
  const [rows, threads] = await Promise.all([
    fetchAllPaged<ListRow>((from, to) =>
      db
        .from(ADVICE)
        .select(`${ADVICE_VIEW_COLUMNS}, thread_id, action, why, created_at, scope_keys`)
        .eq("tenant_id", owner.tenantId)
        .eq("asked_by", owner.userId)
        .order("id")
        .range(from, to)
        .returns<ListRow[]>(),
    ),
    fetchAllPaged<{ id: string; title: string | null }>((from, to) =>
      db
        .from(THREADS)
        .select("id, title")
        .eq("tenant_id", owner.tenantId)
        .eq("user_id", owner.userId)
        .is("deleted_at", null)
        .order("id")
        .range(from, to)
        .returns<{ id: string; title: string | null }[]>(),
    ),
  ]);
  const titles = new Map(threads.map((t) => [t.id, t.title?.trim() || "제목 없는 대화"]));
  return rows
    .filter((r) => titles.has(r.thread_id) && covers(scope, r.scope_keys))
    .map((r) => ({
      view: adviceViewOf(r),
      action: r.action,
      why: r.why,
      threadId: r.thread_id,
      threadTitle: titles.get(r.thread_id)!,
      messageId: r.message_id,
      createdAt: r.created_at,
    }));
}
