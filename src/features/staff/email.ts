// 직원 이메일 판별 헬퍼 — 순수 공유 모듈(서버 액션 "use server" 파일은 non-async export 불가라 분리).
export const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * 임포트 산물 이메일인가 — 형식불량(공백 등, "LAB 김주희@imported.local") 또는 @imported.local
 * 플레이스홀더(POC 이관). 이런 이메일만 직원 수정 화면에서 편집을 허용한다(서버도 동일 기준 이중 검증).
 * 실 로그인 이메일(정상 형식 + 실 도메인)은 잠금 유지 — 계정 정체성 오변경 방지.
 */
export function isImportArtifactEmail(email: string): boolean {
  const e = email.trim();
  return !EMAIL_RE.test(e) || e.toLowerCase().endsWith("@imported.local");
}
