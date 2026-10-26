/**
 * 월간계획 가져오기 **기록·조회** — 서버 전용 IO. 규칙은 [`import-undo.ts`](../import-undo.ts) 한 곳.
 *
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 * ⚠️ 표(0430a)가 없어도 **가져오기는 막지 않는다**([[#95]]) — 기록만 안 남고 되돌리기 메뉴가 안 뜬다.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import {
  diffImport,
  historyKindOf,
  IMPORT_FIELDS,
  splitBatchRows,
  type HistoryKind,
  type HistoryMeta,
  type ImportedRow,
  type ImportPlanMeta,
  type LineFields,
} from "../import-undo";

type Admin = ReturnType<typeof createAdminClient>;
type LineRow = LineFields & { id: string; updated_by: string | null };

const LINE_COLS = `id, updated_by, ${IMPORT_FIELDS.join(", ")}`;

/** 그 반·기간의 계획 줄 전부(평시·내신). 한 반 두 달 남짓이라 수백 줄 이하지만 절단을 피해 페이지로 받는다(B2). */
export async function snapshotPlanLines(
  admin: Admin,
  tenantId: string,
  classId: string,
  from: string,
  to: string,
): Promise<LineRow[]> {
  return fetchAllPaged<LineRow>((f, t) =>
    admin
      .from("class_sheet_plan_lines")
      .select(LINE_COLS)
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .gte("plan_date", from)
      .lte("plan_date", to)
      .order("id", { ascending: true })
      .range(f, t) as never,
  );
}

/** 가져오기 앞뒤 차이를 기록한다. 실패는 삼킨다(가져오기는 이미 끝났다) — 기록 id(없으면 null)만 돌려준다. */
export async function recordImportBatch(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  from: string;
  to: string;
  actorId: string;
  before: readonly LineRow[];
  /** 이 반영을 만든 교재 배정 — 되돌리기가 배정까지 지운다(`ImportPlanMeta`). */
  plan?: { id: string; title: string | null } | null;
}): Promise<string | null> {
  try {
    const after = await snapshotPlanLines(input.admin, input.tenantId, input.classId, input.from, input.to);
    const rows = diffImport(new Map(input.before.map((r) => [r.id, r])), after, input.actorId);
    // 배정이 있으면 넣은 줄이 0이어도 남긴다 — 그래야 배정 자체를 되돌릴 수 있다.
    if (rows.length === 0 && !input.plan) return null;
    const meta: ImportPlanMeta[] = input.plan ? [{ kind: "plan", planId: input.plan.id, title: input.plan.title }] : [];
    const { data, error } = await input.admin
      .from("class_plan_import_batches")
      .insert({
        tenant_id: input.tenantId,
        class_id: input.classId,
        period_from: input.from,
        period_to: input.to,
        rows: [...meta, ...rows],
        row_count: rows.length,
        created_by: input.actorId,
      })
      .select("id")
      .single();
    // 표 미적용([[#95]])은 고장이 아니다 — 되돌리기만 없을 뿐이라 오류 보고로 시끄럽게 하지 않는다.
    if (error && (error.code === "42P01" || error.code === "PGRST205")) return null;
    if (error) throw error;
    return String(data.id);
  } catch (e) {
    reportError(e, { scope: "textbooks.import-batch.record", classId: input.classId });
    return null;
  }
}

/**
 * 미룸·당김 / 배정 삭제 기록(원장 2026-10-26) — 줄 원소 없이 표식 하나. 실패는 삼킨다(그 동작은 이미 끝났다,
 * 히스토리만 없다). 표가 없으면 null([[#95]]).
 */
export async function recordHistoryEntry(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  /** 기간 칸(NOT NULL) — 미룸·당김은 누른 날, 배정 삭제는 지운 날. */
  date: string;
  actorId: string;
  meta: Exclude<HistoryMeta, ImportPlanMeta>;
  count: number;
}): Promise<string | null> {
  try {
    const { data, error } = await input.admin
      .from("class_plan_import_batches")
      .insert({
        tenant_id: input.tenantId,
        class_id: input.classId,
        period_from: input.date,
        period_to: input.date,
        rows: [input.meta],
        row_count: input.count,
        created_by: input.actorId,
      })
      .select("id")
      .single();
    if (error && (error.code === "42P01" || error.code === "PGRST205")) return null;
    if (error) throw error;
    return String(data.id);
  } catch (e) {
    reportError(e, { scope: "textbooks.history.record", classId: input.classId });
    return null;
  }
}

/**
 * 기록 하나에 '되돌림' 표시를 건다(조건부 — 두 창이 동시에 눌러도 한쪽만). 알림 [되돌리기]와 히스토리가
 * **같은 표시**를 써야 한쪽에서 되돌린 것이 다른 쪽에 다시 뜨지 않는다.
 */
export async function claimHistory(
  admin: Admin,
  tenantId: string,
  classId: string,
  id: string,
  actorId: string,
): Promise<"ok" | "taken" | "error"> {
  const { data, error } = await admin
    .from("class_plan_import_batches")
    .update({ undone_at: new Date().toISOString(), undone_by: actorId })
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("id", id)
    .is("undone_at", null)
    .select("id");
  if (error) return "error";
  return data && data.length > 0 ? "ok" : "taken";
}

/** 되돌리기가 실패하면 표시를 푼다(다시 누를 수 있게). */
export async function releaseHistory(admin: Admin, tenantId: string, id: string): Promise<void> {
  await admin
    .from("class_plan_import_batches")
    .update({ undone_at: null, undone_by: null })
    .eq("tenant_id", tenantId)
    .eq("id", id);
}

/** 되돌리기 ▾ 메뉴 한 줄 — 언제·무엇을(배정·미룸·당김·배정 삭제)·무슨 교재·몇 줄. */
export type ImportHistoryItem = { id: string; at: string; count: number; title: string | null; kind: HistoryKind };

/** 되돌리기 ▾ 메뉴가 보여 주는 기록 수(원장 2026-10-26 *"최근 5회 작업한거중에"*). */
export const IMPORT_HISTORY_LIMIT = 5;

/**
 * 그 반의 **아직 안 되돌린** 반영, 최신 먼저 최대 5건. 고르면 그 뒤 반영까지 거꾸로 함께 되돌린다
 * (`undoChain` — 중간 하나만 빼면 뒤 반영이 그 칸 위에 쌓인 채라 판정이 틀어진다).
 * 표가 없거나 조회가 실패해도 빈 배열(표시용이라 조용히, [[#95]]).
 */
export async function loadRecentImports(admin: Admin, tenantId: string, classId: string): Promise<ImportHistoryItem[]> {
  try {
    const { data, error } = await admin
      .from("class_plan_import_batches")
      .select("id, created_at, row_count, rows")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .is("undone_at", null)
      .order("created_at", { ascending: false })
      .limit(IMPORT_HISTORY_LIMIT);
    if (error || !data) return [];
    return data.map((r) => {
      const { meta } = splitBatchRows(r.rows);
      return {
        id: String(r.id),
        at: String(r.created_at),
        count: Number(r.row_count ?? 0),
        title: meta?.title ?? null,
        kind: historyKindOf(meta),
      };
    });
  } catch {
    return [];
  }
}

/** 되돌리기 재료 — 기록 한 건. */
export async function loadImportBatch(
  admin: Admin,
  tenantId: string,
  classId: string,
  batchId: string,
): Promise<{ rows: ImportedRow[]; plan: ImportPlanMeta | null; meta: HistoryMeta | null; undone: boolean } | null> {
  const { data, error } = await admin
    .from("class_plan_import_batches")
    .select("rows, undone_at")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("id", batchId)
    .maybeSingle();
  if (error || !data) return null;
  return { ...splitBatchRows(data.rows), undone: Boolean(data.undone_at) };
}
