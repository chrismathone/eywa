import { FACT_GUARD } from "@/lib/ai/fact-guard";
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
import { kstToday } from "@/lib/date-kst";
import { reportWarning } from "@/lib/observability/report-error";
import type { AssistantTurn } from "../turns";
import { hasSpecialTokenNoise, parseInlineToolCalls, stripMarkdownEmphasis } from "../solar-tokens";
import {
  buildGrounding,
  findGroundingIssues,
  stripUngroundedSentences,
  type GroundingIssue,
} from "../grounding";
import { assistantTools } from "./tools";

/** Solar가 툴콜을 본문 토큰으로 뱉어 답을 못 만든 경우 — 다음 provider(Claude) 폴백 대상. */
const FORMAT_ERROR_MARK = "모델이 툴 호출 형식을 본문으로 출력했습니다";
function isFormatError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(FORMAT_ERROR_MARK);
}

/** 모델이 툴콜도 텍스트도 없이 빈 응답을 낸 경우 — 이 역시 다음 provider 폴백 가치가 있다. */
const EMPTY_ANSWER_MARK = "AI 응답이 비어 있습니다";
function isEmptyAnswerError(e: unknown): boolean {
  return e instanceof Error && e.message.includes(EMPTY_ANSWER_MARK);
}

/**
 * 이 루프가 실제 서빙할 수 있는 provider 체인 — 구현이 있는 upstage(OpenAI 호환)·anthropic만.
 * ⚠️ resolveModelChain은 DEEPSEEK_API_KEY가 있으면 deepseek 후보도 주는데, 이 파일엔 deepseek
 * 클라이언트 분기가 없어 그 후보가 runAnthropicLoop로 흘러 Anthropic API에 deepseek 모델 id를
 * 보내는 죽은 폴백(404)이 됐었다(2026-07-17 적대 리뷰 확정). deepseek tool-use 루프를 붙이기
 * 전까진 체인에서 제외한다.
 */
function supportedChain(): { provider: AiProvider; model: string }[] {
  return resolveModelChain("balanced", "default", "upstage").filter(
    ({ provider }) => provider === "upstage" || provider === "anthropic",
  );
}

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

/** 시스템 프롬프트 — 오늘 날짜(KST)를 넣어야 "이번 달/오늘"류 기간 추측 오답을 막는다(2026-07-17 실측: 날짜 없인 2025-10을 지어냄). */
function buildSystemPrompt(todayKst: string): string {
  return [
    `당신은 학원 원장을 보좌하는 '매니저 팀' AI 비서입니다. 오늘은 ${todayKst}(한국 시간)입니다. 단순 조회 대행이 아니라, 데이터를 읽고 판단해 다음 행동까지 제안하는 실무 매니저처럼 답합니다. 학원 데이터는 반드시 제공된 툴로 조회해 그 결과에만 근거해 답합니다.`,
    "- 한국어 존댓말, 간결하게(사실 3~5문장 + 제안 1~2문장). 마크다운·별표·헤더 없이 일반 문장으로.",
    "- 숫자·이름·날짜는 툴 결과 그대로. 조회로 확인 못 한 내용은 추정하지 말고 모른다고 답합니다.",
    "- **사실 나열에 그치지 말 것**: 조회된 데이터 **안에서** 눈에 띄는 패턴을 매니저 관점에서 짚고, 그래서 무엇을 하면 좋을지 **구체적 다음 행동**을 한두 문장 덧붙입니다. 데이터에 실제로 드러난 신호(특정일에 퇴원이 몰림, 대기 상담이 쌓임, 작성률이 목표에 못 미침, 미납액이 큼 등)는 적극적으로 짚어 조치를 제안하십시오 — 예) '주 후반 독려가 필요해 보입니다', '미납 안내 문자를 권합니다', '담당 강사에게 상담을 요청하십시오', '같은 날 다수 퇴원은 원인 확인이 필요합니다'. ⚠️ 이 예시 문구는 설명용일 뿐이니 그대로 베끼지 말고, **반드시 이번 조회 결과의 실제 수치·항목으로만** 말하십시오(예시의 숫자를 답변에 옮기지 마십시오).",
    "- ⚠️ **없는 것을 지어내기 절대 금지**(판단과 별개, 가장 중요): 툴 결과에 **없는 외부 비교(전월 대비·지난주 평균 등)·추세·원인·비율·정책을 만들어내지 마십시오.** 조회되지 않은 근거·이유를 덧붙이면 날조라 금지입니다. 비교가 필요하면 그 데이터를 툴로 먼저 조회하고, 없으면 이번 값 자체로만 판단합니다.",
    "- 즉 **조회된 값 안에서는 적극 판단·제안, 조회 안 된 것은 절대 지어내지 않기**가 원칙입니다. 데이터에서 우려·조치할 점이 정말 없을 때만 '현재 특이사항 없습니다'로 담백하게 끝냅니다(있는 신호를 덮으려 남용 금지).",
    "- 날짜·기간 인자는 사용자가 명시했을 때만 지정합니다. '이번 달'·'오늘' 질문은 인자를 **생략**해 기본값(현재)을 쓰십시오.",
    "- 학생 관련 질문은 search_students로 학생을 특정한 뒤 상세 툴을 씁니다. 동명이인이면 학교·학년을 되묻습니다.",
    "- 선생님·직원 관련 질문은 search_staff로 특정한 뒤 get_staff_summary를, 보고서 작성 현황은 get_report_writing_status를 씁니다.",
    "- 반(수업) 질문은 search_classes → get_class_detail, 회의록 질문은 search_meetings → get_meeting_summary 순서로 씁니다.",
    "- 신규생 등록상담은 search_enrollment_consultations, 퇴원은 recent_withdrawals를 씁니다(재원생 상담은 search_consultations).",
    "- 영어 단어·코드·내부 키 이름을 답변에 노출하지 않습니다.",
    "- 주민번호·계좌·급여·연락처 등 민감 정보 질문에는 도울 수 없다고 답합니다.",
    // 비서는 generateJSON을 안 거치는 자체 툴 루프라 공통 사실 가드를 여기서 직접 잇는다(원장 2026-07-23).
    FACT_GUARD,
  ].join("\n");
}

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

/** grounding 이슈 → 모델에게 줄 교정 지시(무엇이 날조인지 구체적으로). */
function buildGroundingCorrection(issues: GroundingIssue[]): string {
  const uniq = (k: GroundingIssue["kind"]) => [...new Set(issues.filter((i) => i.kind === k).map((i) => i.token))];
  const parts: string[] = [];
  const cmp = uniq("comparison");
  const money = uniq("money");
  const pct = uniq("percent");
  if (cmp.length) parts.push(`조회에 없는 비교(${cmp.join(", ")})`);
  if (money.length) parts.push(`조회에 없는 금액(${money.join(", ")})`);
  if (pct.length) parts.push(`조회에 없는 비율(${pct.join(", ")})`);
  return `방금 답변에 ${parts.join(", ")}이(가) 들어갔습니다. 이는 조회된 사실이 아니라 지어낸 내용입니다. 그 부분을 완전히 빼고 조회된 수치·사실만으로 다시 답하십시오. 없는 비교·평균·추세·비율·금액은 절대 언급하지 마십시오.`;
}

/**
 * 답변 grounding 하네스 — 툴 결과(팩트)에 근거하지 않은 수치·금액·비교가 있으면 ① 재생성 1회
 * ② 그래도 남으면 근거 없는 문장 제거. 툴 미사용 답(인사·권한거절)은 대조 대상이 없어 그대로 통과.
 * 약한 모델(Solar) 전제 방어(CLAUDE.md: buildFormPatch·validateTeamReport와 동일 정신).
 */
async function enforceGrounding(
  answer: string,
  toolResults: string[],
  question: string,
  todayKst: string,
  regenerate: (correction: string) => Promise<string>,
): Promise<string> {
  if (!answer || toolResults.length === 0) return answer;
  const g = buildGrounding([...toolResults, question, todayKst]);
  const issues = findGroundingIssues(answer, g);
  if (issues.length === 0) return answer;
  reportWarning("비서 답변 grounding 이슈 → 교정", {
    scope: "assistant.grounding",
    kinds: [...new Set(issues.map((i) => i.kind))].join(","),
    tokens: issues.map((i) => i.token).slice(0, 6).join(" | "),
  });
  let best = answer;
  let bestIssues = issues;
  try {
    const retried = await regenerate(buildGroundingCorrection(issues));
    if (retried) {
      const retryIssues = findGroundingIssues(retried, g);
      if (retryIssues.length < bestIssues.length) {
        best = retried;
        bestIssues = retryIssues;
      }
    }
  } catch {
    // 재생성 실패는 무시 — 아래 문장 제거로 안전하게 수렴.
  }
  if (bestIssues.length === 0) return best;
  return stripUngroundedSentences(best, g); // 최후: 근거 없는 문장 제거
}

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
  const todayKst = kstToday();
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(todayKst) },
    ...history.map((turn) => ({ role: turn.role, content: turn.content }) as const),
    { role: "user", content: question },
  ];
  const toolResults: string[] = []; // grounding 대조용 팩트 원천

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
    let calls = msg.tool_calls ?? [];
    if (calls.length === 0) {
      // Solar가 툴콜을 구조화 필드가 아니라 **본문 텍스트 토큰**으로 뱉는 경우 실측(2026-07-17
      // 프로덕션 첫 질문에서 raw 토큰이 답변으로 저장됨) — 파싱해 표준 툴 호출로 승격시킨다.
      const inline = parseInlineToolCalls(msg.content ?? "");
      if (inline.calls.length > 0 && round < MAX_ROUNDS) {
        calls = inline.calls.map((call, index) => ({
          id: call.id || `inline_${round}_${index}`,
          type: "function" as const,
          function: { name: call.name, arguments: call.args || "{}" },
        }));
        messages.push({ role: "assistant", content: inline.stripped || null, tool_calls: calls });
      } else {
        const answer = stripMarkdownEmphasis((msg.content ?? "").trim());
        // 파싱 못 삼킨 특수 토큰이 남은 답은 사용자에게 절대 노출 금지(raw 코드 노출 금지) — 폐기.
        if (hasSpecialTokenNoise(answer)) throw new Error(FORMAT_ERROR_MARK);
        const grounded = await enforceGrounding(answer, toolResults, question, todayKst, async (correction) => {
          messages.push({ role: "assistant", content: answer });
          messages.push({ role: "user", content: correction });
          const r = await client.chat.completions.create({ model, max_tokens: 1024, temperature: 0.2, messages, tool_choice: "none" });
          usage.input += r.usage?.prompt_tokens ?? 0;
          usage.output += r.usage?.completion_tokens ?? 0;
          return stripMarkdownEmphasis((r.choices[0]?.message?.content ?? "").trim());
        });
        return { answer: grounded, toolCalls };
      }
    } else {
      messages.push(msg);
    }
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
      toolResults.push(content);
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
  const todayKst = kstToday();
  const messages: MessageParam[] = [
    ...history.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: question },
  ];
  const toolResults: string[] = []; // grounding 대조용 팩트 원천

  let toolCalls = 0;
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    // ⚠️ temperature 금지 — Claude 5 계열(sonnet-5)은 temperature가 deprecated라 400
    // "`temperature` is deprecated for this model."로 폴백 경로 전체가 죽는다(2026-07-17 프로덕션 실측).
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      system: buildSystemPrompt(todayKst),
      messages,
      tools: toolDefs as never,
      ...(round === MAX_ROUNDS ? { tool_choice: { type: "none" as const } } : {}),
    });
    usage.input += res.usage?.input_tokens ?? 0;
    usage.output += res.usage?.output_tokens ?? 0;
    const toolUses = res.content.filter((block) => block.type === "tool_use");
    if (toolUses.length === 0 || res.stop_reason !== "tool_use") {
      const answer = stripMarkdownEmphasis(
        res.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim(),
      );
      const grounded = await enforceGrounding(answer, toolResults, question, todayKst, async (correction) => {
        const msgs: MessageParam[] = [
          ...messages,
          { role: "assistant", content: answer },
          { role: "user", content: correction },
        ];
        const r = await client.messages.create({
          model,
          max_tokens: 1024,
          system: buildSystemPrompt(todayKst),
          messages: msgs,
        });
        usage.input += r.usage?.input_tokens ?? 0;
        usage.output += r.usage?.output_tokens ?? 0;
        return stripMarkdownEmphasis(
          r.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim(),
        );
      });
      return { answer: grounded, toolCalls };
    }
    messages.push({ role: "assistant", content: res.content });
    const results = [] as { type: "tool_result"; tool_use_id: string; content: string }[];
    for (const use of toolUses) {
      toolCalls++;
      const toolContent = await runTool(tools, use.name, use.input);
      toolResults.push(toolContent);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: toolContent,
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
  const chain = supportedChain();
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
      // 빈 답변 검사는 recordUsage(ok:true) **이전** — 뒤에 두면 catch의 ok:false 기록과 합쳐져
      // 같은 호출 usage가 2행(토큰 2배)으로 적재된다(비용 비교 데이터 오염, 적대 리뷰 확정).
      if (!result.answer) throw new Error(EMPTY_ANSWER_MARK);
      await recordUsage({
        meta: { tenantId: opts.tenantId, feature: "assistant_chat" },
        provider,
        model,
        keyName: "default",
        usage: { inputTokens: usage.input || null, outputTokens: usage.output || null },
        ok: true,
      });
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
      // 키/한도 오류 + Solar 형식 오류(툴콜 본문 토큰 유출) + 빈 응답은 다음 provider(Claude)로 폴백.
      if (i < chain.length - 1 && (isRetryableProviderError(e) || isFormatError(e) || isEmptyAnswerError(e))) {
        reportWarning(`비서 ${provider} 실패 → 다음 provider 폴백`, {
          scope: "assistant.loop.fallback",
          provider,
          model,
          reason: e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120),
        });
        continue;
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** provider 노출용(디버그·문서) — 현재 체인 순서(이 루프가 실제 서빙 가능한 후보만). */
export function assistantProviderChain(): { provider: AiProvider; model: string }[] {
  return supportedChain().map(({ provider, model }) => ({ provider, model }));
}
