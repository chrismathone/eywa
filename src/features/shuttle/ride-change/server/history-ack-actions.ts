"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { canRecordBoarding } from "../../server/record-gate";

type AckState = { ok: true } | { error: string };

/**
 * 변경 내역 한 줄을 **확인** — 관리자 '학부모 등하원' 화면에서 내린다(0323a, 사용자 2026-09-30 "실제 디비는 남지만 더이상
 * 화면 뷰에서 나오지 않게"). 장부(0321a·0322a)는 추가만 되는 표라 건드리지 않고 **확인 표식만 따로** 쌓는다
 * (`shuttle_history_acks`). 화면은 `queries.ts`의 `ackedHistoryIds`가 표식 있는 줄을 빼고 그린다.
 *
 * 🔑 게이트 = 등하원 **기록 축**(`canRecordBoarding` — 사무실 ∪ 셔틀 담당 ∪ super_admin) — 셔틀 담당·데스크가 처리하는
 *    일이다(열람 전용은 못 누른다). 편성 게이트(`canWriteTenant("shuttle")`)를 쓰면 정작 셔틀 선생님이 못 누른다.
 * 🔑 학원 공용 — 한 사람이 확인하면 모두의 화면에서 내려간다. 다시 눌러도 같다(멱등 · 먼저 누른 사람이 남는다).
 * 🔴 우리 학원의 장부 줄인지 먼저 확인한다 — admin은 RLS 우회라 남의 학원 id를 받아 적을 수 있다([[#104]]).
 * ⚠️ 0323a 전이면 한글 안내로 돌려준다([[#95]] — 화면은 표가 없어도 산다: 아무것도 숨기지 않는다).
 */
export async function ackShuttleHistory(kind: string, historyId: string): Promise<AckState> {
  // 확인한 사람(acked_by·acked_by_name)은 화면 주인 — 강사뷰면 검증된 대상(자격 canRecordBoarding과 같은 사람).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canRecordBoarding())) return { error: "변경 내역을 확인할 권한이 없습니다" };
  if ((kind !== "ride" && kind !== "regular") || !historyId) return { error: "확인할 내역을 찾지 못했습니다" };

  const admin = createAdminClient();
  const table = kind === "ride" ? "shuttle_ride_exception_history" : "shuttle_rider_history";
  const { data: row, error: rowError } = await admin.from(table).select("id")
    .eq("tenant_id", user.tenantId).eq("id", historyId).maybeSingle();
  if (rowError || !row) return { error: "확인할 내역을 찾지 못했습니다" };

  const { error } = await admin.from("shuttle_history_acks").upsert(
    {
      tenant_id: user.tenantId,
      history_kind: kind,
      history_id: historyId,
      acked_by: user.id,
      acked_by_name: user.displayName,
    },
    // 먼저 확인한 사람이 사실이다 — 다시 눌러도 덮지 않는다.
    { onConflict: "tenant_id,history_kind,history_id", ignoreDuplicates: true },
  );
  if (error) {
    const missing = error.code === "42P01" || error.code === "PGRST205" || /shuttle_history_acks/.test(error.message ?? "");
    return { error: missing ? "확인 기능이 아직 켜지지 않았습니다(DB 적용 필요)" : "확인을 저장하지 못했습니다" };
  }

  await logAction({ action: "shuttle_history_ack", targetType: "shuttle", metadata: { kind, historyId } });
  revalidatePath("/shuttle/parent-rides");
  return { ok: true };
}
