import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 0311a `slack_rules.actor_ids`('누가' 필터) 칸이 DB에 있나 — SQL은 원장이 손으로 돌리므로 앱이 먼저 나가도 죽지 않게([[#95]]).
 * 있으면 한 번 확인한 뒤로 다시 묻지 않는다. 없으면 매번 다시 본다(SQL을 적용한 순간부터 재배포 없이 켜지게).
 */
export const ACTOR_COL_MISSING_MESSAGE = "'누가' 필터를 저장할 칸이 아직 DB에 없습니다(0311a 적용 필요) — '누가'를 비우면 저장됩니다";

/** 이 오류가 "actor_ids 칸이 없다"인가(42703 = Postgres · PGRST204 = PostgREST 스키마 캐시). `exclude_actor_ids`와 헷갈리지 않게 앞 글자를 본다. */
export function isMissingActorCol(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (err.code === "42703" || err.code === "PGRST204" || /schema cache|does not exist/.test(msg)) && /(^|[^_a-z])actor_ids/.test(msg);
}

let known = false;

export async function hasActorIdsColumn(tenantId: string): Promise<boolean> {
  if (known) return true;
  const { error } = await createAdminClient().from("slack_rules").select("actor_ids").eq("tenant_id", tenantId).limit(1);
  if (!error) known = true;
  // 칸이 없다는 오류가 아니면(일시 장애 등) 있다고 보고 저장을 시도한다 — 저장 쪽 오류가 그대로 드러난다.
  return !error || !isMissingActorCol(error);
}
