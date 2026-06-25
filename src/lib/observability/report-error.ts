/**
 * 자체 관측성(외부 서비스 없이) — 실패를 "보이게" 만드는 단일 진입점.
 *
 * 배경: 웹훅의 background write(admin.from().update())나 AI 분석 실패가 그동안 조용히 묻혀
 * 운영자가 학원의 결제/출석/AI 파이프라인이 깨진 걸 사용자 불만으로만 알았다(운영적합성 감사 B3).
 * 구조화 JSON 한 줄로 console.error → Vercel 함수 로그에서 `scope`로 grep 가능. 의존성 0.
 *
 * 호출 규약: `reportError(error, { scope: "webhook.meeting.complete", recordId })`.
 * scope는 `<영역>.<핸들러>.<단계>` 점 표기로 두어 로그 검색/집계가 쉽게.
 */

type ErrorContext = Record<string, unknown>;

/** Supabase PostgrestError 모양({ message, code, details, hint })을 안전 추출. */
function supabaseFields(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (!("code" in error) && !("details" in error) && !("hint" in error)) return undefined;
  const e = error as { code?: unknown; details?: unknown; hint?: unknown };
  return { code: e.code, details: e.details, hint: e.hint };
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const supa = supabaseFields(error);
  try {
    console.error(
      JSON.stringify({
        level: "error",
        ...context,
        message,
        ...(supa ? { supabase: supa } : {}),
        stack,
        ts: new Date().toISOString(),
      }),
    );
  } catch {
    // 순환 참조 등으로 stringify 실패 시 평문 폴백(절대 throw 안 함 — 로깅이 흐름을 깨면 안 됨).
    console.error("[reportError]", context, message, stack ?? "");
  }
}

export function reportWarning(message: string, context: ErrorContext = {}): void {
  try {
    console.warn(JSON.stringify({ level: "warn", ...context, message, ts: new Date().toISOString() }));
  } catch {
    console.warn("[reportWarning]", context, message);
  }
}
