import "server-only";

/**
 * 보고서 삭제에 딸린 **진도 되감기** — 그 보고서가 밀어 올린 진도 기록을 없던 일로 되돌린다
 * (원장 2026-08-18 *"진도기록도 되돌려야지"*).
 *
 * ## 두 단계로 나뉘어 있는 이유(순서가 곧 안전이다)
 * `progress_entries.report_id`는 FK가 `on delete set null`이라 **보고서를 지우면 연결이 끊긴다** →
 * 지운 뒤엔 어느 엔트리가 그 보고서 것인지 알 수 없다. 그렇다고 되감기를 먼저 끝내면, 그 다음
 * 보고서 삭제가 실패했을 때 **보고서는 남고 진도만 사라진 반쪽 상태**가 영구로 남는다(재-ingest는
 * 저장할 때만 도니 아무도 복구하지 않는다). 그래서
 *   ① `captureProgressForReports` — 지우기 **전에** 대상 엔트리 id와 컨테이너 id만 읽어 둔다.
 *   ② `applyProgressRollback` — 보고서 삭제가 **성공한 뒤** 실제로 지우고 컨테이너를 재계산한다.
 *
 * ⚠️ ②는 실패해도 본 삭제를 되돌리지 않는다(진도는 파생 기록). 대신 몇 건을 되감았는지 돌려주고
 *    실패는 서버 로그에 남긴다 — 조용히 0건이면 "매일 멀쩡해 보이는" 고장이 된다.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { rollbackContainer, type RemainingEntry } from "../rollback";

export type CapturedProgress = {
  /** 지울 엔트리 id. */
  entryIds: string[];
  /** 재계산 대상 컨테이너 id(중복 제거). */
  containerIds: string[];
  /** 이벤트를 지울 보고서 id. */
  reportIds: string[];
};

export type ProgressRollbackResult = {
  /** 되감은 엔트리 수. */
  entries: number;
  /** 상태를 되돌린 컨테이너 수. */
  containers: number;
  /** 통째로 지운(엔트리가 하나도 안 남은) 컨테이너 수. */
  droppedContainers: number;
};

/** 보고서를 지우기 **전에** 호출 — 그 보고서에 매달린 진도 엔트리·컨테이너를 기억해 둔다. */
export async function captureProgressForReports(
  tenantId: string,
  reportIds: string[],
): Promise<CapturedProgress> {
  const empty: CapturedProgress = { entryIds: [], containerIds: [], reportIds };
  if (!reportIds.length) return { ...empty, reportIds: [] };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("progress_entries")
    .select("id, container_id")
    .eq("tenant_id", tenantId)
    .in("report_id", reportIds);
  if (error) {
    console.error("[progress-rollback] capture 실패", error.message);
    return empty;
  }
  return {
    entryIds: (data ?? []).map((r) => r.id as string),
    containerIds: [...new Set((data ?? []).map((r) => r.container_id as string))],
    reportIds,
  };
}

/** 보고서 삭제가 **성공한 뒤** 호출 — 기억해 둔 엔트리·이벤트를 지우고 컨테이너를 재계산한다. */
export async function applyProgressRollback(
  tenantId: string,
  captured: CapturedProgress,
): Promise<ProgressRollbackResult> {
  const result: ProgressRollbackResult = { entries: 0, containers: 0, droppedContainers: 0 };
  const admin = createAdminClient();

  if (captured.reportIds.length) {
    const { error } = await admin
      .from("progress_events")
      .delete()
      .eq("tenant_id", tenantId)
      .in("report_id", captured.reportIds);
    if (error) console.error("[progress-rollback] 이벤트 삭제 실패", error.message);
  }
  if (!captured.entryIds.length) return result;

  const { error: delErr } = await admin
    .from("progress_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .in("id", captured.entryIds);
  if (delErr) {
    // 못 지웠으면 컨테이너 수치도 건드리지 않는다(수치가 실물과 어긋나면 더 나쁘다).
    console.error("[progress-rollback] 엔트리 삭제 실패", delErr.message);
    return result;
  }
  result.entries = captured.entryIds.length;

  for (const containerId of captured.containerIds) {
    const [{ data: rest }, { data: container }] = await Promise.all([
      admin
        .from("progress_entries")
        .select("created_at, global_position")
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
      createdAt: String(r.created_at),
      globalPosition: (r.global_position as number | null) ?? null,
    }));
    const next = rollbackContainer(remaining, (container?.start_position as number | null) ?? null);

    if (next.dropContainer) {
      // 🔴 빈 컨테이너는 **지운다** — 남겨 두면 지운 수업 위치가 "현재 진도"로 계속 읽힌다(위 주석).
      //    다음 인제스트가 새로 연다 = 보강을 추가하기 전 상태.
      const { error } = await admin
        .from("progress_containers")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", containerId);
      if (error) console.error("[progress-rollback] 빈 컨테이너 삭제 실패", error.message);
      else result.droppedContainers += 1;
      continue;
    }
    const { error: updErr } = await admin
      .from("progress_containers")
      .update({
        last_position: next.lastPosition,
        chapter_count: next.chapterCount,
        max_jump: next.maxJump,
      })
      .eq("tenant_id", tenantId)
      .eq("id", containerId);
    if (updErr) console.error("[progress-rollback] 컨테이너 재계산 실패", updErr.message);
    else result.containers += 1;
  }
  return result;
}
