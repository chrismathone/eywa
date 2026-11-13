import type Anthropic from "@anthropic-ai/sdk";

/** 기존 도구 실행기의 내부 메시지 계약. 네트워크 제공자·인증·추론 선택은 포함하지 않는다. */
export type AssistantUsage = Partial<Pick<Anthropic.Usage, "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens">>;
export type AssistantMessage = Pick<Anthropic.Message, "id" | "model" | "content" | "stop_reason"> & { usage: AssistantUsage };
export type AssistantStream = {
  readonly currentMessage?: AssistantMessage;
  finalMessage(): Promise<AssistantMessage>;
  on?: {
    (event: "streamEvent", listener: (event: Anthropic.RawMessageStreamEvent) => void): unknown;
    (event: "inputJson", listener: (partial: string, snapshot: unknown) => void): unknown;
  };
};
export type AssistantClient = {
  messages: {
    stream(params: Anthropic.MessageCreateParams, options?: { signal?: AbortSignal }): AssistantStream;
  };
};
