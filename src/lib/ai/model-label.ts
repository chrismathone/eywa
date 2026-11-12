/**
 * 저장된 model_version(예: "deepseek-v4-pro-2026-07-16", "claude-sonnet-5-2026-07-16")을
 * 직원에게 보여줄 **짧은 친화적 라벨**로 매핑한다("DeepSeek v4-pro", "Claude Sonnet 5").
 *
 * 배경: 모델을 번갈아 쓰게 되면서(2026-07-16) "어떤 모델로 분석됐는지"가 직원에게 유용한 정보가 됐다.
 * 단 원시 id를 그대로 뿌리면 노이즈(+ "UI에 raw 코드 노출 금지" 규칙)라 매핑을 거친다.
 * 알 수 없는 모델은 `null` — 원시 id를 흘리느니 표시하지 않는다.
 *
 * 순수 함수(SDK/서버 의존 없음) — 클라이언트 컴포넌트에서 바로 import 가능.
 */
export function modelDisplayLabel(modelVersion: string | null | undefined): string | null {
  if (!modelVersion) return null;
  const id = modelVersion.toLowerCase();
  if (id.includes("deepseek-v4-pro")) return "DeepSeek v4-pro";
  if (id.includes("deepseek-v4-flash")) return "DeepSeek v4-flash";
  // 새 이름(2026-10-19~) — V4.1-Flash. 옛 이름으로 저장된 분석은 위 줄이 그대로 'v4-flash'로 보인다.
  if (id.includes("deepseek-flash")) return "DeepSeek V4.1 flash";
  if (id.includes("deepseek")) return "DeepSeek";
  if (id.includes("gpt-6.1-terra")) return "ChatGPT 6.1 Terra";
  if (id.includes("gpt-6-luna")) return "ChatGPT 6 Luna";
  if (id.includes("gpt-5.6-terra")) return "ChatGPT 5.6 Terra";
  if (id.includes("gpt-5.6-luna")) return "ChatGPT 5.6 Luna";
  // 5.5(2026-10-19~)를 먼저 — 그 전에 저장된 분석('claude-sonnet-5-날짜')은 그대로 'Sonnet 5'로 보인다.
  if (id.includes("sonnet-5-5")) return "Claude Sonnet 5.5";
  if (id.includes("sonnet")) return "Claude Sonnet 5";
  if (id.includes("haiku")) return "Claude Haiku";
  if (id.includes("opus")) return "Claude Opus";
  if (id.includes("claude")) return "Claude";
  if (id.includes("solar")) return "Solar Pro 3";
  if (id.includes("gemini")) return "Gemini";
  if (id.includes("gpt")) return "ChatGPT";
  return null;
}
