import "server-only";

/**
 * 보고서 삭제에 딸린 **진도 되감기** — 그 보고서가 밀어 올린 진도 기록을 없던 일로 되돌린다
 * (원장 2026-08-18 *"진도기록도 되돌려야지"*).
 *
 * `progress_entries.report_id`는 FK가 `on delete set null`이라 보고서를 지워도 엔트리는 **남는다**.
 * 그래서 지우기 **전에** 이 함수를 부른다 — 지운 뒤엔 어느 엔트리가 그 보고서 것인지 알 길이 없다.
 *
 * 되감는 대상 3종: ① `progress_entries` 그 행 ② `progress_events` 그 보고서 이벤트
 * ③ `progress_containers`의 `last_position`·`chapter_count`·`max_jump`(남은 엔트리로 **재계산**).
 *
 * ⚠️ 실패해도 **본 삭제를 막지 않는다**(best-effort). 진도는 파생 기록이고, 여기서 throw하면 이미
 *    지운 출결·보고서와 어긋난 반쪽 상태가 된다. 대신 몇 건을 되감았는지 돌려줘 호출부가 알린다.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { rollbackContainer, type RemainingEntry } from "../rollback";

export type ProgressRollbackResult = {
  /** 되감은 엔트리 수. */
  entries: number;
  /** 상태를 되돌린 컨테이너 수. */
  containers: number;
};

/**
 * 보고서 id들의 진도 기록을 되감는다. **보고서를 지우기 전에** 호출할 것.
 * @param tenantId admin 클라이언트는 RLS를 우회하므로 모든 쿼리에 명시한다(#104).
 */
export async function rollbackProgressForReports(
  tenantId: string,
  reportIds: string[],
): Promise<ProgressRollbackResult> {
  const result: ProgressRollbackResult = { entries: 0, containers: 0 };
  if (!reportIds.length) return result;
  const admin = createAdminClient();

  const { data: entries, error } = await admin
    .from("progress_entries")
    .select("id, container_id, report_id")
    .eq("tenant_id", tenantId)
    .in("report_id", reportIds);
  if (error || !entries?.length) {
    // 이벤트만 남아 있을 수 있으니 그건 지우고 끝낸다(엔트리 없이 열림/닫힘 이벤트만 있는 경우).
    await admin.from("progress_events").delete().eq("tenant_id", tenantId).in("report_id", reportIds);
    return result;
  }

  const containerIds = [...new Set(entries.map((e) => e.container_id as string))];
  const removeIds = new Set(entries.map((e) => e.id as string));

  const { error: delErr } = await admin
    .from("progress_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .in("id", [...removeIds]);
  if (delErr) return result; // 못 지웠으면 컨테이너도 건드리지 않는다(수치가 실물과 어긋나면 더 나쁘다)
  result.entries = removeIds.size;

  await admin.from("progress_events").delete().eq("tenant_id", tenantId).in("report_id", reportIds);

  // 컨테이너마다 **남은 엔트리로 다시 계산**한다(빼기 산술은 틀린다 — rollback.ts 주석).
  for (const containerId of containerIds) {
    const [{ data: rest }, { data: container }] = await Promise.all([
      admin
        .from("progress_entries")
        .select("entry_date, global_position")
        .eq("tenant_id", tenantId)
        .eq("container_id", containerId),
      admin
        .from("progress_containers")
        .select("start_position")
        .eq("tenant_id", tenantId)
        .eq("id", containerId)
        .maybeSingle(),
    ]);
    const remaining: RemainingEntry[] = (rest ?? []).map((r) => ({
      entryDate: String(r.entry_date),
      globalPosition: (r.global_position as number | null) ?? null,
    }));
    const next = rollbackContainer(remaining, (container?.start_position as number | null) ?? null);
    const { error: updErr } = await admin
      .from("progress_containers")
      .update({
        last_position: next.lastPosition,
        chapter_count: next.chapterCount,
        max_jump: next.maxJump,
      })
      .eq("tenant_id", tenantId)
      .eq("id", containerId);
    if (!updErr) result.containers += 1;
  }
  return result;
}
