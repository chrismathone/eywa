import "server-only";
/**
 * AI 비서 대화 루프 — generateJSON(단발 JSON)과 별개의 tool-use 진입점.
 *
 * provider 전환형(원장 지시 2026-07-17: Solar Pro 3 투입): 기본 = Upstage solar-pro3(OpenAI 호환
 * function calling, ~20–25배 저렴), 키 오류·한도 시 Anthropic(Sonnet 5)으로 폴백 — resolveModelChain
 * (prefer "upstage") 체인 그대로. 품질 열세가 확인되면 prefer 인자 한 줄로 Claude 우선 전환.
 *
 * 안전 불변식: 툴은 전부 read-only + 사용자 세션(쿠키 createClient) 실행 = RLS·권한 자동 상속.
 * 툴 인자는 tool.parse(zod)로 검증(모델 인자 환각 차단), 실패는 모델에게 오류로 돌려준다.
 * usage는 라운드 합산으로 ai_usage_logs 1행(feature=assistant_chat) — Solar vs Claude 비용 비교 재료.
 */
import type OpenAI from "openai";
import { getUpstage } from "@/lib/ai/upstage";
import { getAnthropic } from "@/lib/ai/anthropic";
import { recordUsage, isRetryableProviderError } from "@/lib/ai/generate";
import { resolveModelChain, type AiProvider } from "@/lib/ai/models";
import { reportWarning } from "@/lib/observability/report-error";
import type { AssistantTurn } from "../turns";
import { assistantTools } from "./tools";

/**
 * betaZodTool 반환(BetaRunnableTool)은 SDK 내장 툴들까지 포함한 유니온이라 custom 툴 필드
 * (description·input_schema)가 타입에 안 잡힌다 — 우리 레지스트리는 전부 custom 툴이므로
 * 구조적 타입으로 1회 좁힌다(런타임 검증: keys = type·name·input_schema·description·run·parse).
 */
type RegisteredTool = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  parse: (content: unknown) => unknown;
  run: (args: never) => Promise<unknown> | unknown;
};

function registeredTools(): RegisteredTool[] {
  return assistantTools() as unknown as RegisteredTool[];
}

const MAX_ROUNDS = 5; // 툴 왕복 상한(무한 루프·비용 폭주 방지)
const MAX_TOOL_RESULT_CHARS = 6000; // 툴 결과 1건 상한(컨텍스트 폭주 방지)
const MAX_HISTORY_TURNS = 12; // 모델에 넘길 직전 대화 턴 수

const SYSTEM_PROMPT = [
  "당신은 학원 원장을 보좌하는 '매니저 팀' AI 비서입니다. 학원 데이터는 반드시 제공된 툴로 조회해 그 결과에만 근거해 답합니다.",
  "- 한국어 존댓말, 간결하게(3~6문장, 목록이 나으면 짧은 불릿).",
  "- 숫자·이름·날짜는 툴 결과 그대로. 조회로 확인 못 한 내용은 추정하지 말고 모른다고 답합니다.",
  "- 학생 관련 질문은 search_students로 학생을 특정한 뒤 상세 툴을 씁니다. 동명이인이면 학교·학년을 되묻습니다.",
  "- 영어 단어·코드·내부 키 이름을 답변에 노출하지 않습니다.",
  "- 주민번호·계좌·급여 등 민감 정보 질문에는 도울 수 없다고 답합니다.",
].join("\n");

export type AssistantLoopResult = {
  answer: string;
  model: string;
  toolCalls: number;
};

function clip(text: string): string {
  return text.length > MAX_TOOL_RESULT_CHARS ? `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(잘림)` : text;
}

/** 툴 1건 실행 — 인자 zod 검증 실패·런타임 오류는 모델에게 한 줄 오류로(루프는 계속). */
async function runTool(tools: RegisteredTool[], name: string, rawInput: unknown): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return `오류: 알 수 없는 툴 ${name}`;
  try {
    const args = tool.parse(rawInput);
    const result = await tool.run(args as never);
    return clip(typeof result === "string" ? result : JSON.stringify(result));
  } catch (e) {
    return `오류: ${e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300)}`;
  }
}

type Usage = { input: number; output: number };

/** Upstage(OpenAI 호환) tool-use 루프. */
async function runOpenAiCompatLoop(
  model: string,
  question: string,
  history: AssistantTurn[],
  usage: Usage,
): Promise<{ answer: string; toolCalls: number }> {
  const client = getUpstage("default");
  const tools = registeredTools();
  const toolDefs: OpenAI.Chat.Completions.ChatCompletionTool[] = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.input_schema as Record<string, unknown>,
    },
  }));
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((turn) => ({ role: turn.role, content: turn.content }) as const),
    { role: "user", content: question },
  ];

  let toolCalls = 0;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const res = await client.chat.completions.create({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      messages,
      tools: toolDefs,
      // 마지막 라운드는 툴 금지 — 상한에 걸려도 지금까지 조회분으로 답을 마무리하게 강제.
      tool_choice: round === MAX_ROUNDS ? "none" : "auto",
    });
    usage.input += res.usage?.prompt_tokens ?? 0;
    usage.output += res.usage?.completion_tokens ?? 0;
    const msg = res.choices[0]?.message;
    if (!msg) throw new Error("AI 응답이 비어 있습니다");
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) return { answer: (msg.content ?? "").trim(), toolCalls };
    messages.push(msg);
    for (const call of calls) {
      if (call.type !== "function") continue;
      toolCalls++;
      let rawInput: unknown = {};
      try {
        rawInput = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        rawInput = { __parse_error: call.function.arguments };
      }
      const content = await runTool(tools, call.function.name, rawInput);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error("툴 호출이 상한을 초과했습니다"); // 도달 불가(마지막 라운드 tool_choice none)
}

/** Anthropic tool-use 루프(폴백 경로). */
async function runAnthropicLoop(
  model: string,
  question: string,
  history: AssistantTurn[],
  usage: Usage,
): Promise<{ answer: string; toolCalls: number }> {
  const client = getAnthropic("default");
  const tools = registeredTools();
  const toolDefs = tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? "",
    input_schema: tool.input_schema,
  }));
  type MessageParam = Parameters<typeof client.messages.create>[0]["messages"][number];
  const messages: MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: question },
  ];

  let toolCalls = 0;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: 0.2,
      system: SYSTEM_PROMPT,
      messages,
      tools: toolDefs as never,
      ...(round === MAX_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    const toolUses = res.content.filter((block) => block.type === "tool_use");
    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      const answer = res.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      return { answer, toolCalls };
    }
    messages.push({ role: "assistant", content: res.content });
    const results = [] as { type: "tool_result"; tool_use_id: string; content: string }[];
    for (const use of toolUses) {
      toolCalls++;
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: await runTool(tools, use.name, use.input),
      });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("툴 호출이 상한을 초과했습니다");
}

/**
 * 비서 질문 1건 처리 — provider 체인(Solar 우선)을 돌며 첫 성공을 반환.
 * ⚠️ 호출부(askAssistant)가 canManageStaff 게이트·질문 길이 검증을 이미 통과시켰다는 전제.
 */
export async function runAssistantLoop(opts: {
  question: string;
  history: AssistantTurn[];
  tenantId: string;
}): Promise<AssistantLoopResult> {
  const history = opts.history.slice(-MAX_HISTORY_TURNS);
  const chain = resolveModelChain("balanced", "default", "upstage");
  if (chain.length === 0) throw new Error("AI 키가 설정되어 있지 않습니다(UPSTAGE/ANTHROPIC).");

  let lastErr: unknown;
  for (let i = 0; i < chain.length; i++) {
    const { provider, model } = chain[i];
    const usage: Usage = { input: 0, output: 0 };
    try {
      const result =
        provider === "upstage"
          ? await runOpenAiCompatLoop(model, opts.question, history, usage)
          : await runAnthropicLoop(model, opts.question, history, usage);
      await recordUsage({
        meta: { tenantId: opts.tenantId, feature: "assistant_chat" },
        provider,
        model,
        keyName: "default",
        usage: { inputTokens: usage.input || null, outputTokens: usage.output || null },
        ok: true,
      });
      if (!result.answer) throw new Error("AI 응답이 비어 있습니다");
      return { ...result, model };
    } catch (e) {
      lastErr = e;
      await recordUsage({
        meta: { tenantId: opts.tenantId, feature: "assistant_chat" },
        provider,
        model,
        keyName: "default",
        usage: { inputTokens: usage.input || null, outputTokens: usage.output || null },
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      });
      if (i < chain.length - 1 && isRetryableProviderError(e)) {
        reportWarning(`비서 ${provider} 실패 → 다음 provider 폴백`, {
          scope: "assistant.loop.fallback",
          provider,
          model,
        });
        continue;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** provider 노출용(디버그·문서) — 현재 체인 순서. */
export function assistantProviderChain(): { provider: AiProvider; model: string }[] {
  return resolveModelChain("balanced", "default", "upstage").map(({ provider, model }) => ({ provider, model }));
}
