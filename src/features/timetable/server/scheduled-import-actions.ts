"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import {
  canManageSheetSync,
  SHEET_ACCESS_DENIED_MSG,
} from "@/features/integrations/server/sheet-access";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { getScheduledImports } from "./scheduled-import-queries";
import { canManageTimetableImport } from "./import-access";
import { logDbError } from "@/lib/supabase/db-error";

export type CancelScheduledState = {
  error?: string;
  reverted?: { snapshots: number };
};

/**
 * 예약된 가져오기 **취소** — 원장 2026-08-28 *"그럼 모든게 무로 돌아가는거야. 마치 아무것도 안한것처럼"*.
 *
 * 그 날짜로 예약된 스냅샷을 **전부**, 적용의 역순(반이동 → 배치)으로 되돌린다. 하나만 되돌리면
 * 배치와 명단이 어긋난 채 남는다.
 *
 * 🔴 미래분만 취소할 수 있다. 이미 시작된 변경은 그 사이 출결·보고서가 붙었을 수 있어 되돌리면
 *    그 기록이 존재하지 않는 배치·수강에 매달린다(0233a도 같은 조건을 DB에서 다시 막는다).
 * ⚠️ 게이트는 적용과 같은 쌍이다(#77) — 화면에서 x를 숨기는 것만으로는 게이트가 아니다.
 */
export async function cancelScheduledImport(
  effectiveDate: string,
): Promise<CancelScheduledState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageSheetSync(user.systemRole)))
    return { error: SHEET_ACCESS_DENIED_MSG };
  if (!(await canWriteTenant(user.systemRole, "classes")))
    return { error: "시간표 관리 권한이 없습니다" };

  const date = (effectiveDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: "취소할 적용일이 올바르지 않습니다" };
  if (date <= kstToday())
    return {
      error:
        "이미 시작된 변경은 취소할 수 없습니다 — 시트를 고쳐 다시 가져오세요.",
    };

  // 🔴 되돌릴 대상은 클라가 보낸 목록이 아니라 **서버가 다시 조회한** 그 날짜의 스냅샷이다.
  const group = (await getScheduledImports()).find(
    (g) => g.effectiveDate === date,
  );
  if (!group)
    return {
      error: "그 날짜에 예약된 변경이 없습니다(이미 취소됐을 수 있습니다).",
    };

  const supabase = await createClient();

  // Master-sheet batches include teacher blocks. Cancel the entire date atomically,
  // including those blocks, instead of leaving a half-restored timetable.
  const { data: masterRows, error: masterError } = await supabase
    .from("timetable_snapshots")
    .select("source:payload->apply->masterSource")
    .in("id", group.snapshotIds);
  if (masterError) {
    logDbError(masterError, "timetable.cancelScheduledImport");
    return { error: "예약 내용을 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  if (masterRows?.some((r) => r.source)) {
    if (!(await canManageTimetableImport(user.systemRole)))
      return { error: "반 일괄 관리 권한이 필요합니다." };
    const { openMasterDb, cancelMasterDate } = await import(
      "./master-sheet-store"
    );
    let sql: ReturnType<typeof openMasterDb> | undefined;
    try {
      sql = openMasterDb();
      const reverted = await cancelMasterDate(sql, user, date);
      try {
        revalidatePath("/timetable");
        revalidatePath("/classes");
        revalidatePath("/students", "layout");
        revalidatePath("/ecs");
        revalidatePath("/attendance");
      } catch (e) {
        console.error(
          "[master-sheet] cache refresh",
          e instanceof Error ? e.message : "failed",
        );
      }
      return { reverted };
    } catch (e) {
      console.error(
        "[master-sheet] cancel",
        e instanceof Error ? e.message : "failed",
      );
      return {
        error:
          e instanceof Error && /[가-힣]/.test(e.message)
            ? e.message
            : "예약을 취소하지 못했습니다. 전체 변경은 유지되었습니다. 다시 확인해 주세요.",
      };
    } finally {
      await sql
        ?.end()
        .catch(() => console.error("[master-sheet] DB cleanup failed"));
    }
  }
  let done = 0;
  // 되돌리지 못하고 남긴 수강 수(이미 시작된 것) — 0이 아니면 취소가 부분적이다.
  let leftover = 0;
  for (const id of group.snapshotIds) {
    // 종류는 스냅샷 payload가 정한다 — 배치는 0087a/0231a, 반이동은 0233a.
    const { data: snap } = await supabase
      .from("timetable_snapshots")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    const payload = snap?.payload as Record<string, unknown> | null | undefined;
    const isStructure = !!payload && "kind" in payload;
    const fn = isStructure
      ? "rollback_english_structure"
      : "rollback_enrollment_import";
    const { data: res, error } = await supabase.rpc(fn, { p_snapshot_id: id });
    if (error) {
      // SQL 미적용(0233a)이면 함수가 없다 — 원문 대신 무엇을 해야 하는지 한글로 알린다([[#95]]).
      const missing = /could not find the function|does not exist/i.test(
        error.message,
      );
      // 🔴 부분 실패를 **정확히** 알린다(2026-08-29 적대 리뷰 codex): 취소는 스냅샷별 순차 RPC라
      //    중간에 멈추면 배치와 명단이 갈린 채 남는다. "다시 눌러 주세요"가 실제 복구 수단인 이유는
      //    되돌리기가 **멱등**이기 때문 — 이미 되돌린 스냅샷은 0건 처리된다. 그 사실을 문구에 담는다.
      const rest = group.snapshotIds.length - done;
      console.error("[scheduled-import] 취소 실패:", error);
      return {
        error: missing
          ? "취소에 필요한 DB 함수가 아직 적용되지 않았습니다. 관리자에게 SQL 적용(0233a·0236a)을 요청하세요."
          : done > 0
            ? `취소를 ${done}건 되돌리고 ${rest}건에서 멈췄습니다 — 시간표와 명단이 어긋난 상태입니다. ` +
              `같은 ×를 다시 눌러 주세요(이미 되돌린 건은 건너뜁니다).`
            : "취소하지 못했습니다(변경 없음). 잠시 후 다시 시도해 주세요.",
      };
    }
    // 🔴 0236a는 **이미 시작된 행은 손대지 않고** `skipped`로 알린다(그 사이 출결이 붙었을 수 있다).
    //    그걸 성공으로 삼키면 "모든 게 무로 돌아갔다"가 거짓말이 된다 — 남은 것을 정확히 말한다.
    const skipped = Number((res as { skipped?: number } | null)?.skipped ?? 0);
    if (skipped > 0) leftover += skipped;
    done += 1;
  }

  revalidatePath("/timetable");
  if (leftover > 0) {
    return {
      reverted: { snapshots: done },
      error:
        `예약을 되돌렸지만 ${leftover}건은 이미 시작돼 그대로 두었습니다 — ` +
        `그 사이 출결이 붙었을 수 있어 지우지 않습니다. 학생 상세 수업 탭에서 확인해 주세요.`,
    };
  }
  return { reverted: { snapshots: done } };
}
