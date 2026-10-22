import "server-only";
import { buildTeacherLabelMap } from "@/features/timetable/lib/teacher-label";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logDbError } from "@/lib/supabase/db-error";
import { weekRange, type CellMemo } from "../rules";
import { teacherKeyResolver, type TeacherKeyResolver } from "../teacher-key";

/**
 * 칸 메모 조회(0394a `timetable_cell_memos`).
 * 🔴 admin 전용(정책 0개) → **모든 조회에 tenant_id 명시**. 게이트는 호출부가 `memoSheetAccess`로 먼저 본다.
 * 🔴 fail-soft([[#95]]): 표가 아직 없으면 `unavailable` — 강사뷰는 메모 없이 그대로 열린다.
 * 조회 범위는 언제나 **그 주 7일**(B2 — 지점 전체 무기한 조회 금지) · `fetchAllPaged`(1000행 침묵 절단 방지).
 */

export const CELL_MEMO_TABLE = "timetable_cell_memos";
export const CELL_MEMO_COLS =
  "id, subject, memo_date, teacher_key, teacher_label, start_min, body, box_w, box_h, version, updated_at, updated_by";

export type CellMemoRow = {
  id: string;
  subject: string;
  memo_date: string;
  teacher_key: string;
  teacher_label: string;
  start_min: number;
  body: string;
  box_w: number | null;
  box_h: number | null;
  version: number;
  updated_at: string;
  updated_by: string | null;
};

export type CellMemoLoad = { status: "ok"; memos: CellMemo[] } | { status: "unavailable" };

export function isCellMemoTableMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = err.message ?? "";
  return m.includes(CELL_MEMO_TABLE) && /does not exist|schema cache|could not find/i.test(m);
}

export type TeacherIndex = { resolver: TeacherKeyResolver; nameOf: (id: string | null) => string | null };

/** 지점 직원 — 강사 열쇠 풀기와 '마지막 수정자' 이름을 한 번의 조회로. */
export async function loadTeacherIndex(tenantId: string): Promise<TeacherIndex> {
  const rows = await fetchAllPaged<{ id: string; display_name: string | null; english_name: string | null; status: string | null }>(
    (from, to) =>
      createAdminClient()
        .from("users")
        .select("id, display_name, english_name, status")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
  );
  const people = rows.map((u) => ({
    id: u.id,
    displayName: u.display_name,
    englishName: u.english_name,
    active: u.status === "active",
  }));
  const names = new Map(people.map((u) => [u.id, u.displayName?.trim() || null]));
  return {
    resolver: teacherKeyResolver(people, buildTeacherLabelMap(people)),
    nameOf: (id) => (id ? (names.get(id) ?? null) : null),
  };
}

/** 저장 행 → 화면 메모(열 라벨·수정자 이름은 호출부가 안다). */
export function rowToCellMemo(row: CellMemoRow, col: string, updatedByName: string | null): CellMemo {
  return {
    id: row.id,
    date: row.memo_date,
    col,
    startMin: row.start_min,
    body: row.body,
    width: row.box_w,
    height: row.box_h,
    version: row.version,
    updatedAt: row.updated_at,
    updatedByName,
  };
}

/** 저장 행 → 화면 메모. 열 라벨을 못 풀면 null(그 메모는 화면 어느 칸에도 서지 않는다). */
export function toCellMemo(row: CellMemoRow, index: TeacherIndex, col?: string): CellMemo | null {
  const label = col ?? index.resolver.labelOf(row.teacher_key, row.teacher_label);
  return label ? rowToCellMemo(row, label, index.nameOf(row.updated_by)) : null;
}

export async function loadWeekCellMemos(tenantId: string, subject: string, weekMonday: string): Promise<CellMemoLoad> {
  const { from, to } = weekRange(weekMonday);
  let rows: CellMemoRow[];
  try {
    rows = await fetchAllPaged<CellMemoRow>((a, b) =>
      createAdminClient()
        .from(CELL_MEMO_TABLE)
        .select(CELL_MEMO_COLS)
        .eq("tenant_id", tenantId)
        .eq("subject", subject)
        .gte("memo_date", from)
        .lte("memo_date", to)
        .order("id")
        .range(a, b),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isCellMemoTableMissing({ message })) logDbError({ message }, "timetableCellMemo.load", { subject, weekMonday });
    return { status: "unavailable" };
  }
  if (rows.length === 0) return { status: "ok", memos: [] };
  const index = await loadTeacherIndex(tenantId);
  return { status: "ok", memos: rows.map((r) => toCellMemo(r, index)).filter((m): m is CellMemo => m != null) };
}

/** 한 줄 — 동시 저장 충돌 때 최신을 돌려줄 때 쓴다. 없으면 null(지워졌다). */
export async function loadCellMemoRow(
  tenantId: string,
  match: { id: string } | { subject: string; date: string; teacherKey: string; startMin: number },
): Promise<CellMemoRow | null> {
  let q = createAdminClient().from(CELL_MEMO_TABLE).select(CELL_MEMO_COLS).eq("tenant_id", tenantId);
  q =
    "id" in match
      ? q.eq("id", match.id)
      : q.eq("subject", match.subject).eq("memo_date", match.date).eq("teacher_key", match.teacherKey).eq("start_min", match.startMin);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as CellMemoRow | null) ?? null;
}
