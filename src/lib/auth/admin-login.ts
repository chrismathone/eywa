// Supabase Auth는 이메일을 식별자로 사용한다. 관리자 ID는 로그인 화면에서만 이 내부 주소로 바꾼다.
// 이 주소는 비밀번호/권한을 대신하지 않는다. 실제 접근은 super_admins 멤버십으로 검증한다.
export const ADMIN_LOGIN_ID = "admin7099";
export const ADMIN_AUTH_EMAIL = "admin7099@login.aywa.co.kr";

export function isAdminLoginId(value: string): boolean {
  return value.trim().toLowerCase() === ADMIN_LOGIN_ID;
}

export function loginEmailFor(value: string): string {
  return isAdminLoginId(value) ? ADMIN_AUTH_EMAIL : value.trim();
}

export function isAdminAuthEmail(value: string): boolean {
  return value.trim().toLowerCase() === ADMIN_AUTH_EMAIL;
}
