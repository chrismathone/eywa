import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import type { CurrentUser } from "@/lib/auth/current-user";
import type { UsageRow } from "../ingest";

/**
 * 이용 시간 적립 — 일별 롤업 표(0292a `page_usage_daily`)에 **더한다**(행을 쌓지 않는다: 사람×화면×하루 = 1행).
 *
 * 🔑 지점·사용자·권한은 **세션에서** 온다(getCurrentUser) — 비콘 본문은 화면과 숫자만 싣는다. 슈퍼관리자 계정은
 *    DB 함수가 `super_admin` 권한으로 따로 적는다(학원 통계를 흐리지 않게, 화면에서 걸러 볼 수 있게).
 * 🔴 service_role로만 부른다 — 함수 실행 권한이 service_role에만 있다(학원 사용자가 PostgREST로 직접 못 부른다).
 * ⚠️ 실패해도 던지지 않는다 — 계측이 화면·요청을 막으면 안 된다. 표가 아직 없을 때(마이그레이션 적용 전, [[#95]])도 조용히 넘어간다.
 */
export async function recordPageUsage(user: CurrentUser, rows: readonly UsageRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await createAdminClient().rpc("record_page_usage", {
      p_tenant: user.tenantId,
      p_user: user.id,
      p_role: user.systemRole,
      p_day: kstToday(),
      p_items: rows,
    });
    if (error) console.error(`[usage] 이용 시간 기록 실패: ${error.message}`);
  } catch (e) {
    console.error("[usage] 이용 시간 기록 실패", e);
  }
}
