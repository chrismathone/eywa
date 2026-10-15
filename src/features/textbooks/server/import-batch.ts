/**
 * 월간계획 가져오기 **기록·조회** — 서버 전용 IO. 규칙은 [`import-undo.ts`](../import-undo.ts) 한 곳.
 *
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 * ⚠️ 표(20261015170000)가 없어도 **가져오기는 막지 않는다**([[#95]]) — 기록만 안 남고 되돌리기 메뉴가 안 뜬다.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { diffImport, IMPORT_FIELDS, type ImportedRow, type LineFields } from "../import-undo";

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
}): Promise<string | null> {
  try {
    const after = await snapshotPlanLines(input.admin, input.tenantId, input.classId, input.from, input.to);
    const rows = diffImport(new Map(input.before.map((r) => [r.id, r])), after, input.actorId);
    if (rows.length === 0) return null;
    const { data, error } = await input.admin
      .from("class_plan_import_batches")
      .insert({
        tenant_id: input.tenantId,
        class_id: input.classId,
        period_from: input.from,
        period_to: input.to,
        rows,
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

export type LastImport = { id: string; at: string; count: number };

/**
 * 그 반의 **가장 최근** 가져오기 — 이미 되돌렸으면 null(더 옛것으로 내려가지 않는다, SQL 헤더 🔑).
 * 표가 없거나 조회가 실패해도 null(표시용이라 조용히).
 */
export async function loadLastImport(admin: Admin, tenantId: string, classId: string): Promise<LastImport | null> {
  try {
    const { data, error } = await admin
      .from("class_plan_import_batches")
      .select("id, created_at, row_count, undone_at")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data || data.undone_at) return null;
    return { id: String(data.id), at: String(data.created_at), count: Number(data.row_count ?? 0) };
  } catch {
    return null;
  }
}

/** 되돌리기 재료 — 기록 한 건. */
export async function loadImportBatch(
  admin: Admin,
  tenantId: string,
  classId: string,
  batchId: string,
): Promise<{ rows: ImportedRow[]; undone: boolean } | null> {
  const { data, error } = await admin
    .from("class_plan_import_batches")
    .select("rows, undone_at")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .eq("id", batchId)
    .maybeSingle();
  if (error || !data) return null;
  return { rows: (data.rows ?? []) as ImportedRow[], undone: Boolean(data.undone_at) };
}
