import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";

// 퇴사자 로그인 차단(원장 2026-09-29 *"퇴사자 당연히 로그인 차단 동반해야지"*).
// 앱 쪽 벽은 getCurrentUser(status='inactive' → 비로그인 취급)가 맡고, 여기서는 **Supabase 로그인 계정 자체**를
// 막는다 — 새 로그인·토큰 갱신이 거절되어 PostgREST 직결 같은 앱 밖 경로도 곧 닫힌다(이미 받은 access
// token은 만료까지 유효). super-admin 콘솔의 `set_user_active`와 같은 값(876000h ≈ 100년 / "none")을 쓴다.
// ⚠️ 실패해도 퇴사 처리 자체는 되돌리지 않는다 — 앱 쪽 벽이 이미 막고 있고, 로그인 계정이 없는
//    데이터 전용 직원(#31, 404)도 흔하다. 실패는 reportError로만 드러낸다.

const BAN_FOREVER = "876000h";

export async function setStaffLoginBlocked(userId: string, blocked: boolean): Promise<void> {
  try {
    const { error } = await createAdminClient().auth.admin.updateUserById(userId, {
      ban_duration: blocked ? BAN_FOREVER : "none",
    });
    if (error && error.status !== 404 && !/user not found/i.test(error.message)) {
      reportError(error, { scope: "staff.setStaffLoginBlocked", userId, blocked });
    }
  } catch (e) {
    reportError(e, { scope: "staff.setStaffLoginBlocked", userId, blocked });
  }
}
