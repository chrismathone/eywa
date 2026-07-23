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

/**
 * 이 직원의 로그인 이메일을 직원관리에서 고칠 수 있는가.
 *
 * ① 임포트 산물(형식불량·@imported.local) — 애초에 로그인용이 아니다.
 * ② **아직 한 번도 로그인하지 않은 계정** — 초대할 때 낸 오타(`@gmil.com`)를 고치는 유일한 통로다.
 *    실제로 2026-07-23 신규 직원 초대에 도메인 오타가 나 화면에서 못 고쳤다(원장 "이메일 수정 어케함?").
 *    그 계정으로는 아무도 들어온 적이 없으니 "누구의 로그인인지"가 아직 정해지지 않았다 = 바꿔도 정체성 변경이 아니다.
 *
 * ⚠️ **한 번이라도 로그인한 계정은 계속 잠금** — 그건 그 사람의 실제 로그인 수단이라, 화면에서 갈아끼우면
 * 조용한 계정 탈취 통로가 된다(바꿔야 하면 본인 확인 후 Supabase Auth에서).
 */
export function canEditLoginEmail(email: string, everSignedIn: boolean): boolean {
  return isImportArtifactEmail(email) || !everSignedIn;
}
