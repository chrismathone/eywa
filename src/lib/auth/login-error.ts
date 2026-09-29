/** Keep authentication errors actionable without exposing raw service messages. */
export function loginErrorMessage(error: { code?: string; status?: number; message?: string }): string {
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(error.message ?? "")) {
    return "계정 또는 비밀번호가 올바르지 않습니다.";
  }
  // 퇴사 처리 때 로그인 계정을 막는다(auth-ban, 원장 2026-09-29) — Supabase는 `user_banned`로 거절한다.
  if (error.code === "user_banned" || /user is banned/i.test(error.message ?? "")) {
    return "사용이 중지된 계정입니다. 다시 일하게 되셨다면 학원 원장님께 계정 복구를 요청해 주세요.";
  }
  if (error.code === "email_not_confirmed") {
    return "계정 확인이 필요합니다. 학원 관리자에게 문의해 주세요.";
  }
  return "로그인하지 못했습니다. 잠시 후 다시 시도하거나 학원 관리자에게 문의해 주세요.";
}
