import "server-only";
import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { Response, ResponseInputItem, ResponseUsage } from "openai/resources/responses/responses";
import type { AssistantClient, AssistantMessage, AssistantUsage } from "./model-client";
import { ASSISTANT_MODEL } from "./models";

/** 다른 기능의 모델 레지스트리·폴백에는 연결하지 않는 비서 전용 키. 키 값은 외부로 보내지 않는다. */
export function assistantKeyEnv(): "OPENAI_API_KEY_ASSISTANT" | "OPENAI_API_KEY" | null {
  if (process.env.OPENAI_API_KEY_ASSISTANT?.trim()) return "OPENAI_API_KEY_ASSISTANT";
  if (process.env.OPENAI_API_KEY?.trim()) return "OPENAI_API_KEY";
  return null;
}

/** 장부 계약은 캐시를 뺀 입력 + 캐시 읽기다. Responses 입력에는 캐시가 포함돼 있어 한 번만 뺀다. */
export function terraUsage(usage: ResponseUsage): AssistantUsage {
  const cached = usage.input_tokens_details.cached_tokens;
  return { input_tokens: Math.max(0, usage.input_tokens - cached), cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: usage.output_tokens };
}

function parseArguments(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; } // 기존 zod·보고서 검사기가 오류를 도구 결과로 돌려 같은 모델이 수정하게 한다.
}

/** purpose를 SQL보다 먼저 보여 준다. 아직 끝나지 않은 JSON 전체를 억지로 복구하지 않는다. */
function progressArguments(text: string): unknown {
  try { return JSON.parse(text); } catch {
    const purpose = /"purpose"\s*:\s*("(?:\\.|[^"\\])*")/.exec(text)?.[1];
    const tables = /"tables"\s*:\s*(\[[^\]]*\])/.exec(text)?.[1];
    return { ...(purpose ? { purpose: parseArguments(purpose) } : {}), ...(tables ? { tables: parseArguments(tables) } : {}) };
  }
}

function messageOf(response: Response): AssistantMessage {
  const content: Anthropic.ContentBlock[] = [];
  let refusal = false;
  for (const item of response.output) {
    if (item.type === "function_call") content.push({ type: "tool_use", id: item.call_id, name: item.name, input: parseArguments(item.arguments), caller: { type: "direct" } });
    else if (item.type === "message") for (const part of item.content) {
      if (part.type === "output_text") content.push({ type: "text", text: part.text, citations: null });
      else if (part.type === "refusal") refusal = true;
    }
  }
  return { id: response.id, model: response.model, content, usage: response.usage ? terraUsage(response.usage) : {}, stop_reason: refusal || response.incomplete_details?.reason === "content_filter" ? "refusal" : response.status === "incomplete" ? "max_tokens" : content.some(b=>b.type === "tool_use") ? "tool_use" : "end_turn" };
}

/**
 * Responses ↔ 기존 실행기의 작은 어댑터. 저장된 보고서/DB 도구/진행 이벤트/검사·재작성 흐름은 유지한다.
 * 네트워크는 Terra low 한 곳만 호출한다. 암호화된 reasoning을 보존하고 SDK 파싱 보조 필드를 뺀 output을 다음 도구 차례에 돌려준다.
 */
export function createTerraClient(client: Pick<OpenAI, "responses">): AssistantClient {
  const nativeOutputs = new WeakMap<object, ResponseInputItem[]>();
  return { messages: { stream(params, options) {
    const input: ResponseInputItem[] = [];
    for (const turn of params.messages) {
      if (typeof turn.content === "string") { input.push({ role: turn.role, content: turn.content }); continue; }
      const native = nativeOutputs.get(turn.content);
      if (native) { input.push(...native); continue; }
      for (const block of turn.content) {
        if (block.type === "text") input.push({ role: turn.role, content: block.text });
        else if (block.type === "tool_result") input.push({ type: "function_call_output", call_id: block.tool_use_id, output: typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "") });
        else if (block.type === "tool_use") input.push({ type: "function_call", call_id: block.id, name: block.name, arguments: JSON.stringify(block.input) });
      }
    }
    const instructions = typeof params.system === "string" ? params.system : params.system?.map(b=>b.text).join("\n\n");
    const tools = (params.tools ?? []).flatMap(tool => "input_schema" in tool ? [{ type: "function" as const, name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false }] : []);
    const native = client.responses.stream({
      model: ASSISTANT_MODEL.model,
      reasoning: { effort: ASSISTANT_MODEL.effort },
      instructions, input, tools, max_output_tokens: params.max_tokens,
      include: ["reasoning.encrypted_content"], store: false, parallel_tool_calls: false,
    }, { signal: options?.signal });
    const events = new Set<(e: Anthropic.RawMessageStreamEvent)=>void>();
    const argumentsListeners = new Set<(partial: string, snapshot: unknown)=>void>();
    const argumentsByItem = new Map<string,string>();
    let currentMessage: AssistantMessage | undefined;
    native.on("event", event => {
      if (event.type === "response.output_item.added" && event.item.type === "function_call") {
        argumentsByItem.set(event.item.id!, event.item.arguments);
        const block: Anthropic.ToolUseBlock = { type: "tool_use", id: event.item.call_id, name: event.item.name, input: {}, caller: { type: "direct" } };
        for (const listener of events) listener({ type: "content_block_start", index: event.output_index, content_block: block });
      } else if (event.type === "response.function_call_arguments.delta") {
        const text = (argumentsByItem.get(event.item_id) ?? "") + event.delta;
        argumentsByItem.set(event.item_id,text);
        for (const listener of argumentsListeners) listener(event.delta,progressArguments(text));
      } else if (event.type === "response.output_item.done" && event.item.type === "function_call") {
        for (const listener of events) listener({ type: "content_block_stop", index: event.output_index });
      } else if (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed") {
        currentMessage = messageOf(event.response);
      }
    });
    return {
      get currentMessage() { return currentMessage; },
      on(event: "streamEvent" | "inputJson", listener: ((event: Anthropic.RawMessageStreamEvent)=>void) | ((partial: string,snapshot: unknown)=>void)) {
        if (event === "streamEvent") events.add(listener as (event: Anthropic.RawMessageStreamEvent)=>void);
        else argumentsListeners.add(listener as (partial: string,snapshot: unknown)=>void);
      },
      async finalMessage() {
        const response = await native.finalResponse();
        currentMessage = messageOf(response);
        if (response.model !== ASSISTANT_MODEL.model && !response.model.startsWith(`${ASSISTANT_MODEL.model}-`)) throw new Error("학원 비서의 응답 모델을 확인하지 못했습니다");
        if (response.status === "failed" || response.status === "cancelled") throw new Error("AI 응답을 끝까지 받지 못했습니다");
        const continuation: ResponseInputItem[] = [];
        for (const item of response.output) {
          // finalResponse()는 API 원문에 parsed_arguments·content[].parsed를 붙인다.
          // 그대로 재전송하면 두 번째 차례가 400으로 끝난다 — 요청에 허용된 필드만 옮긴다.
          if (item.type === "function_call") {
            const { type, id, call_id, name, arguments: args, status, namespace } = item;
            continuation.push({ type, id, call_id, name, arguments: args, status, namespace });
          } else if (item.type === "message") {
            const { type, id, role, status, phase } = item;
            continuation.push({ type, id, role, status, phase, content: item.content.map(part => {
              if (part.type === "refusal") return { type: part.type, refusal: part.refusal };
              const { type, text, annotations, logprobs } = part;
              return { type, text, annotations, logprobs };
            }) });
          } else if (item.type === "reasoning") continuation.push(item);
          else throw new Error("학원 비서가 지원하지 않는 응답을 받았습니다");
        }
        nativeOutputs.set(currentMessage.content,continuation);
        return currentMessage;
      },
    };
  } } };
}

export function getTerraClient(): AssistantClient {
  const env = assistantKeyEnv();
  if (!env) throw new Error("학원 비서의 AI 연결을 확인해 주세요");
  return createTerraClient(new OpenAI({ apiKey: process.env[env]!.trim(), maxRetries: 0 }));
}
