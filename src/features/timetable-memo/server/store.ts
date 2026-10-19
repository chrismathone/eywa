import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";
import { emptyDoc } from "../doc";
import { packSheet, packedSheetSchema, type PackedSheet } from "../pack";

/**
 * 메모 시트 조회(0374a `timetable_memo_sheets`) — 지점 × 과목 한 장.
 * 🔴 admin 전용(정책 0개) → 모든 조회에 tenant_id 명시. 게이트는 호출부가 `memoSheetAccess`로 먼저 본다.
 * 🔴 fail-soft([[#95]]): 표가 아직 없으면(0374a 미적용) `unavailable` — 시간표는 판 없이 그대로 열린다.
 * 저장한 적이 없는 지점은 **빈 엑셀 판**(A~Z × 100행)으로 연다(원장 2026-10-19 *"다른 지점은 그냥 빈 엑셀 같은 뷰"*).
 * 화면에는 **접은 모양 그대로** 내려보낸다(펼친 모양은 칸마다 서식 객체라 RSC 응답이 수 배 커진다) — 펼치기는 클라.
 */

export type MemoSheetLoad =
  | { status: "ok"; packed: PackedSheet; version: number; updatedAt: string | null }
  | { status: "unavailable" };

export function isMemoSheetTableMissing(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === "42P01" || err.code === "PGRST205") return true;
  const m = err.message ?? "";
  return m.includes("timetable_memo_sheets") && /does not exist|schema cache|could not find/i.test(m);
}

export async function loadMemoSheet(tenantId: string, subject: string): Promise<MemoSheetLoad> {
  const { data, error } = await createAdminClient()
    .from("timetable_memo_sheets")
    .select("doc, version, updated_at")
    .eq("tenant_id", tenantId)
    .eq("subject", subject)
    .maybeSingle();
  if (error) {
    if (!isMemoSheetTableMissing(error)) logDbError(error, "timetableMemo.load", { subject });
    return { status: "unavailable" };
  }
  if (!data) return { status: "ok", packed: packSheet(emptyDoc()), version: 0, updatedAt: null };
  const parsed = packedSheetSchema.safeParse(data.doc);
  if (!parsed.success) {
    // 손상된 행을 빈 판으로 보여 주면 다음 자동 저장이 그걸 지운다 — 열지 않는다.
    logDbError({ message: "메모 시트 저장 모양이 틀립니다", code: "invalid_doc" }, "timetableMemo.load", { subject });
    return { status: "unavailable" };
  }
  return { status: "ok", packed: parsed.data, version: data.version as number, updatedAt: (data.updated_at as string | null) ?? null };
}
