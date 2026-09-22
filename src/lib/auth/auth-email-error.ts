/**
 * **로그인 이메일 중복** 판정 — 계정 **생성** 경로 공용(순수 · 서버/클라 어디서든 import 가능, `server-only` 금지 #61).
 *
 * 원장 2026-09-21: *"이메일 로그인이기 때문에 아이디가 중복될 일이 절대 없으므로"* — 지점(테넌트)은 로그인 계정이 정한다(C안).
 * 그 전제를 지키는 것은 `public.users`가 아니라 **Supabase Auth**다: `public.users`의 유니크는 `(tenant_id, email)`이라
 * 지점 안에서만 막고, 전 지점을 통틀어 막는 것은 `auth.users`의 `users_email_partial_key`다(실측 2026-09-21: 60계정 · 60주소 ·
 * `app_metadata.tenant_id` 누락 0 · `users.tenant_id`와 불일치 0).
 *
 * 🔴 그래서 지점이 둘 이상이 되면 **호출부의 지점 안 중복 검사는 다른 지점의 같은 이메일을 못 잡고**, Auth만이 그것을 말해 준다.
 *    그 오류 원문(영어)을 화면에 그대로 내보내면 데스크는 무엇을 해야 할지 모른다(raw 코드 노출 금지).
 *
 * 🔴🔴 **생성과 변경은 Auth의 답이 다르다**(적대 리뷰 2026-09-21, auth-js 2.106 · GoTrue `internal/api/admin.go` 대조):
 *    · `createUser` = 서버가 사전검사 → 422 `email_exists` "A user with this email address has already been registered" → **이 함수가 잡는다**.
 *    · `updateUserById` = 사전검사 없음 → 유니크 위반이 500 `unexpected_failure` "Error updating user"로 뭉개진다 → **이 함수로는 못 잡는다**.
 *      변경 경로는 Auth를 부르기 **전에** [`isLoginEmailTakenElsewhere`](../../features/staff/server/login-email-taken.ts)로 확인한다.
 */

/** 이메일 중복을 뜻하는 Auth 오류 코드. `user_already_exists`는 가입 경로의 같은 뜻(이 앱은 전화번호 가입을 안 쓴다). */
const EMAIL_TAKEN_CODES = new Set(["email_exists", "user_already_exists"]);

/** Auth 관리 API가 "이미 있는 이메일"이라고 답했는가. */
export function isEmailTakenAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  // 코드가 있으면 **코드만** 믿는다 — 문구는 전화번호 중복("…phone number has already been registered")과 겹친다.
  if (typeof e.code === "string" && e.code) return EMAIL_TAKEN_CODES.has(e.code);
  // 코드 없이 문구만 오는 옛 모양: 이메일을 말하고 · 전화번호 얘기가 아니고 · '이미 있다'는 뜻일 때만.
  const msg = typeof e.message === "string" ? e.message : "";
  return /email/i.test(msg) && !/phone/i.test(msg) && /already|exists|taken|registered/i.test(msg);
}

/**
 * 화면 안내문. 🔴 "어느 지점에 있다"는 말하지 않는다(다른 지점의 직원 존재를 알려 줄 이유가 없다) — 무엇을 하면 되는지만.
 */
export const EMAIL_TAKEN_MESSAGE =
  "이미 사용 중인 이메일입니다 — 로그인 이메일은 모든 지점을 통틀어 한 번만 쓸 수 있습니다. 다른 이메일로 등록해 주세요.";
