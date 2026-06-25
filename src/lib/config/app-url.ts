/**
 * 앱 공개 URL 단일 진입점 — AssemblyAI 전사 웹훅 콜백 URL 파생.
 *
 * 배경(운영적합성 감사 B6): 콜백 URL 파생이 3개 흐름(회의·등록상담·학생상담)에 중복됐고, 둘 다 미설정 시
 * `eywa-alpha.vercel.app`로 **조용히** 폴백했다 → 다른 도메인에 배포한 학원이 env를 빠뜨리면 모든 전사 콜백이
 * alpha 호스트로 가 거부되고(시크릿 불일치), 행은 "transcribing"에 영구 정지됐다.
 * 이제 미설정이면 **명확히 throw** → 호출부(전사 제출)가 기존 {error} 처리로 사용자에게 노출. 로컬은 .env.local에 명시.
 */

/** 앱의 공개 base URL. 미설정 시 throw(조용한 alpha 폴백 제거). */
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  throw new Error(
    "NEXT_PUBLIC_APP_URL이 설정되지 않았습니다. 오디오 전사 웹훅 콜백에 필요합니다 — " +
      ".env.local(로컬) 또는 Vercel 환경변수에 NEXT_PUBLIC_APP_URL을 설정하세요.",
  );
}

/** AssemblyAI가 전사 완료 시 호출할 웹훅 콜백 URL. */
export function getAssemblyaiWebhookUrl(): string {
  return `${getAppUrl()}/api/webhooks/assemblyai`;
}
