/**
 * 비밀번호 변경·재설정의 **사람이 고칠 수 있는** Auth 오류를 한글로(수정 계획 P1-E — 원문 노출 대신).
 * 코드로만 판정한다(문구 해석 금지). 해당 없으면 null — 호출부는 `explainDbError` 대체 문구로 간다.
 * ⚠️ `import "server-only"` 금지(#61) — 순수 판정.
 */
export function authPasswordErrorMessage(err: unknown): string | null {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (code === "weak_password") return "비밀번호가 너무 단순합니다 — 더 길게, 영문·숫자를 섞어 다시 정해 주세요";
  if (code === "same_password") return "지금 쓰는 비밀번호와 같습니다 — 다른 비밀번호로 정해 주세요";
  return null;
}
