import { type Instrumentation } from "next";
import { z } from "zod";
import { reportError, reportWarning } from "@/lib/observability/report-error";

/**
 * 부팅 시 환경변수 검증 + 서버 에러 중앙 캡처 (Next 16 instrumentation 컨벤션).
 *
 * 배경(운영적합성 감사): env 무효가 깊은 흐름 안에서 lazy 하게 터져 발견이 늦었고(예: 프로덕션
 * UPSTAGE_API_KEY 무효 → AI 분석 401), 서버 에러를 잡는 곳이 없어 실패가 조용히 묻혔다(B3).
 * - register(): 코어 인프라 env는 부팅서 hard-fail(설정 없이는 서버가 의미 없음), 권장 env는 WARN(무중단 degrade).
 * - onRequestError: 서버 컴포넌트/라우트/액션에서 잡힌 에러를 reportError로 단일 로깅(외부 서비스 없이 Vercel 로그에 구조화).
 */

const CoreEnv = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export function register() {
  // 서버 런타임에서만 강제(빌드/edge 단계의 false-fail 회피). 실제 서버 boot에서 누락을 막는 게 목적.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const core = CoreEnv.safeParse(process.env);
  if (!core.success) {
    const missing = core.error.issues.map((i) => i.path.join(".")).join(", ");
    // hard-fail: 코어 인프라(DB/Supabase) 없이는 서버가 동작 불가 → 조용히 죽기보다 명확히 실패.
    throw new Error(
      `[env] 필수 환경변수 누락/무효: ${missing}. .env.local(로컬) 또는 Vercel 환경변수를 확인하세요.`,
    );
  }

  // 권장(없어도 부팅은 되나 기능 degrade) → WARN으로 표면화.
  const recommended: { key: string; why: string }[] = [
    { key: "NEXT_PUBLIC_APP_URL", why: "오디오 전사 웹훅 콜백 URL(미설정 시 녹음 분석 불가)" },
    { key: "ASSEMBLYAI_API_KEY", why: "녹음 전사" },
    { key: "ASSEMBLYAI_WEBHOOK_SECRET", why: "전사 웹훅 인증" },
    { key: "CRON_SECRET", why: "멈춘 전사 복구·Edutrix 진도 동기화 cron 인증" },
  ];
  for (const { key, why } of recommended) {
    if (!process.env[key]) {
      reportWarning(`[env] 권장 환경변수 미설정: ${key} (${why})`, { scope: "instrumentation.register" });
    }
  }
  const hasAiKey = Object.keys(process.env).some((name) => /^(?:ANTHROPIC|OPENAI)_API_KEY(?:_|$)/.test(name));
  if (!hasAiKey) {
    reportWarning("[env] AI 키 없음: ANTHROPIC_API_KEY*/OPENAI_API_KEY* 모두 미설정 → AI 분석 비활성", {
      scope: "instrumentation.register",
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  reportError(err, {
    scope: "onRequestError",
    digest: (err as { digest?: string })?.digest,
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
