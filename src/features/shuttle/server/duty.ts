import { isMissingColumn } from "@/lib/supabase/db-error";
import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { isModuleOnForTenant } from "@/features/owner/server/modules";

/**
 * 직원 '셔틀 담당' 토글(0227a `users.shuttle_duty`) — 역할을 올리지 않고 셔틀만 여는 개인 표식.
 *
 * 🔴 축이 둘이고 **일부러 다르게** 판정한다:
 *   · `getShuttleDuty`         = 착지(/shuttle/today) · 화면 열람. **새 컬럼만** 본다.
 *   · `hasShuttleRecordDuty`   = 등하원 기록 자격. 컬럼이 아직 없으면 옛 표식으로 폴백한다.
 *
 *   왜 착지는 폴백을 안 쓰나 — 폴백 표식 `attendance_alert_optin`은 "클래스노트 학부모 연락을 받겠다"는
 *   **알림 수신** 토글이다. 0227a가 적용되기 전 창에서 사무실 직원이 그 알림을 켜면, 폴백을 착지에도
 *   쓸 경우 **그 사람 로그인 착지가 셔틀로 바뀐다**(하필 이 겸용을 없애려고 만든 컬럼인데 겸용이 한 겹
 *   더 생긴다). 기록 쪽만 폴백을 두면 셔틀 선생님은 SQL 적용 전에도 계속 찍을 수 있고(#95 배포 간격),
 *   착지·열람은 컬럼이 생긴 뒤에만 움직인다.
 *
 * 🔑 **편성은 어느 쪽도 열지 않는다.** 정류장·회차·배정 편집은 사무실(`canWriteTenant("shuttle")`)
 *    그대로다 — 차에 타는 사람이 동선을 바꿀 수 있게 되면 편성이 조용히 갈린다.
 *
 * ⚠️ admin 클라이언트는 RLS를 우회하므로 **tenant_id 필터 명시**([[#104]]).
 * ⚠️ 실패는 **거부**(fail-closed). 착지는 폴백(역할 홈)이 있어 잠기지 않고, 기록은 못 여는 손해가
 *    잘못 여는 손해보다 작다.
 */
export const getShuttleDuty = cache(async (userId: string, tenantId: string): Promise<boolean> => {
  // 셔틀 모듈이 꺼진 학원은 토글이 있어도 담당이 아니다(착지·열람 우회 차단 — 2026-09-22 방향 B). 침산은 켜져 있다.
  if (!(await isModuleOnForTenant(tenantId, "shuttle"))) return false;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("users")
      .select("shuttle_duty")
      .eq("id", userId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (!error) return data?.shuttle_duty === true;
    // 42703 = undefined_column(0227a 미적용). 다른 에러(권한·네트워크)는 조용히 넘기지 않는다.
    if (!isMissingDutyColumn(error)) reportError(error, { scope: "shuttle.duty" });
    return false;
  } catch (e) {
    reportError(e, { scope: "shuttle.duty" });
    return false;
  }
});

/**
 * 등하원 **기록** 자격의 토글 축 — 새 컬럼, 없으면 0227a 이전 표식(`attendance_alert_optin` = 옛 '셔틀 체크').
 *
 * 🔑 컬럼이 **있으면** 새 축이 진실이다 — false를 옛 표식으로 되살리지 않는다(그러면 겸용이 부활한다).
 *    폴백은 오직 "컬럼이 아직 없다"일 때만 탄다.
 */
export const hasShuttleRecordDuty = cache(
  async (userId: string, tenantId: string): Promise<boolean> => {
    // 기록 자격도 같다 — 셔틀 모듈이 꺼진 학원엔 등하원 기록이 없다.
    if (!(await isModuleOnForTenant(tenantId, "shuttle"))) return false;
    try {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("users")
        .select("shuttle_duty, attendance_alert_optin")
        .eq("id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!error) return data?.shuttle_duty === true;
      if (!isMissingDutyColumn(error)) {
        reportError(error, { scope: "shuttle.duty.record" });
        return false;
      }
      // 0227a 미적용(#95 배포 간격) — 그 시절 표식으로만 판정. 적용 후엔 두 번 다시 안 탄다.
      const { data: legacy, error: legacyErr } = await admin
        .from("users")
        .select("attendance_alert_optin")
        .eq("id", userId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (legacyErr) {
        reportError(legacyErr, { scope: "shuttle.duty.legacy" });
        return false;
      }
      return legacy?.attendance_alert_optin === true;
    } catch (e) {
      reportError(e, { scope: "shuttle.duty.record" });
      return false;
    }
  },
);

function isMissingDutyColumn(error: { code?: string; message?: string }): boolean {
  // 칸 이름 + 없음 코드(공용 판정, P1-E) — 예전엔 42703이면 어느 칸이든, 아니면 이름만 봤다.
  return isMissingColumn(error, ["shuttle_duty", "attendance_alert_optin"]);
}
