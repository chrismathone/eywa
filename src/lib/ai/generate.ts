import type Anthropic from "@anthropic-ai/sdk";
import { withFactGuard } from "./fact-guard";
import { getAnthropic } from "./anthropic";
import { getUpstage } from "./upstage";
import { getDeepseek } from "./deepseek";
import { resolveModel, resolveModelChain, type AiKeyName, type AiProvider, type AiTier } from "./models";
import { reportWarning } from "@/lib/observability/report-error";

/**
 * DeepSeek(v4-pro 등 추론형) 전용 max_tokens 하한. 추론형은 reasoning_content가 max_tokens를 함께 소모해
 * 호출부 값(8192 등)이 추론에 소진되면 답변 JSON이 truncate → 파싱 실패한다. 추론+답변이 모두 들어가도록
 * 여유를 둔다. 상한일 뿐 실사용 토큰만 과금되므로 크게 잡아도 무비용(관측 실사용 ~5k~14k tok).
 */
const DEEPSEEK_MIN_MAX_TOKENS = 32000;

/**
 * ```json 펜스 제거 + 첫 {…} 객체 추출 + JSON.parse. 5개 AI 호출지점에 흩어져 있던 파싱 로직을
 * 한 곳으로 통합. 순수함수(Vitest 단위테스트). JSON mode(Upstage)·평문(Anthropic)·마크다운 펜스·
 * 앞뒤 잡설 섞인 응답 모두 견딘다.
 */
export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 응답에서 JSON을 찾을 수 없습니다");
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      // 3차 — **문자열 안 생 줄바꿈** 복구. 값에 줄바꿈을 허용한 뒤(멘트 알림장) 모델이 `\n` 대신
      // 진짜 개행을 흘리면 JSON이 통째로 깨진다. 그러면 호출부는 "빈 응답"으로 떨어지고
      // 학부모에게는 폴백 템플릿이 나간다 — 파싱 하나 때문에 품질이 무너지는 자리라 마지막으로 손본다.
      // ⚠️ 앞의 정상 파싱 두 번이 모두 실패한 뒤에만 도는 보수적 복구다(정상 JSON은 여기 오지 않는다).
      return JSON.parse(escapeRawNewlinesInStrings(match[0])) as T;
    }
  }
}

/**
 * JSON 텍스트에서 **따옴표 안에 있는** 생 줄바꿈·탭만 이스케이프한다(구조 공백은 그대로).
 * 문자열 밖 개행은 JSON에서 합법이라 건드리면 안 되므로, 따옴표 상태를 세면서 훑는다.
 */
function escapeRawNewlinesInStrings(src: string): string {
  let out = "";
  let inStr = false;
  let escaped = false;
  for (const ch of src) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = inStr; // 문자열 밖의 역슬래시는 이스케이프 시작이 아니다
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (inStr && (ch === "\n" || ch === "\r" || ch === "\t")) {
      out += ch === "\n" ? "\\n" : ch === "\r" ? "" : "\\t";
      continue;
    }
    out += ch;
  }
  return out;
}

export type GenerateJSONOptions = {
  /** 한 개의 user 메시지로 보낼 프롬프트(현 호출부는 전부 단일 user 메시지). */
  prompt: string;
  /** 선택적 system 지침(없으면 미전송). */
  system?: string;
  maxTokens: number;
  /** 기본 balanced(현 모든 호출). reasoning은 Anthropic 고정. */
  tier?: AiTier;
  /** 빌링 버킷. 기본 default(등록상담+회의록), 학생 케어는 "consultations". */
  keyName?: AiKeyName;
  /**
   * provider 선호(강제 아님 — 키 없으면 평소 폴백). 녹음 분석은 구조화 추출 품질을 위해
   * `"anthropic"`(Claude)을 우선한다. 미설정 시 tier/AI_PROVIDER 기본(보통 Upstage Solar).
   */
  provider?: AiProvider;
  /** 생성 temperature(0~1). 미설정 시 provider 기본. 멘트=0.3(사실 서술 일관성, edutrix Solar 후보정 이식). */
  temperature?: number;
  /**
   * Upstage(Solar) reasoning_effort. 멘트="minimal" — 안 하면 추론 과정이 본문에 섞임(edutrix 후보정).
   * Anthropic엔 무시(extended thinking 미사용). 도메인별 opt-in(전역 기본 미변경).
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  /**
   * usage 계측 메타(0113a ai_usage_logs). feature = 호출부 식별자('meeting_analysis' 등),
   * tenantId = 테넌트 귀속(미상이면 생략 → null 기록). 기록은 best-effort — 실패해도 본 호출을 안 막는다.
   */
  meta?: { tenantId?: string | null; feature?: string };
  /**
   * 문서(PDF) 입력 — 스캔 계약서 OCR 전사용(원장 승인 2026-08-03). **Anthropic 전용**(Claude 비전이
   * 스캔 페이지를 직접 읽는다) — 지정 시 후보를 anthropic으로 한정하고, 키가 없으면 명확히 throw
   * (다른 provider의 chat API엔 PDF 입력이 없어 조용한 폴백이 불가능한 자리다).
   */
  document?: { mediaType: "application/pdf"; dataBase64: string };
};

/** provider 응답의 토큰 usage(제공 안 하면 null). */
type ProviderUsage = { inputTokens: number | null; outputTokens: number | null } | null;
/**
 * `truncated` = 모델이 max_tokens 한도에서 말을 끊었다. 이 경우 JSON은 거의 항상 문장 도중에 끊겨
 * 파싱이 깨지는데, 그 실패가 `Expected ',' or ']' after array element`로만 보이면 원인을 못 찾는다
 * (2026-07-31 브리핑 실측: 실패한 날의 output_tokens가 전부 정확히 한도값이었다). 사유를 한글로 표면화한다.
 */
type ProviderCall = { text: string; usage: ProviderUsage; truncated: boolean };

/**
 * ai_usage_logs에 호출 1건 기록 — **best-effort**: env 미설정(테스트·로컬)이면 조용히 스킵, 실패는
 * reportWarning만(AI 호출 흐름을 절대 안 깬다). admin client는 동적 import — generate.ts는 vitest가
 * 직접 import하는 파일이라 `server-only` 모듈(admin.ts)을 정적 import하면 테스트가 깨진다.
 * await 호출(fire-and-forget 금지 — 서버리스 응답 종료 후 floating promise는 드랍될 수 있음).
 * export: generateJSON 밖의 AI 루프(대화형 비서 runAssistantLoop 등)도 같은 계측을 쓴다.
 */
export async function recordUsage(entry: {
  meta?: GenerateJSONOptions["meta"];
  provider: AiProvider;
  model: string;
  keyName: AiKeyName;
  usage?: ProviderUsage;
  ok: boolean;
  error?: string;
}): Promise<void> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { error } = await createAdminClient()
      .from("ai_usage_logs")
      .insert({
        tenant_id: entry.meta?.tenantId ?? null,
        feature: entry.meta?.feature ?? "unknown",
        provider: entry.provider,
        model: entry.model,
        key_name: entry.keyName,
        input_tokens: entry.usage?.inputTokens ?? null,
        output_tokens: entry.usage?.outputTokens ?? null,
        ok: entry.ok,
        error: entry.error ?? null,
      });
    if (error) throw new Error(error.message);
  } catch (e) {
    reportWarning("AI usage 기록 실패", {
      scope: "generateJSON.usage",
      feature: entry.meta?.feature,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * 모든 AI(JSON) 호출의 단일 진입점. `resolveModel`로 provider(기본 Solar Pro 3, env로 Claude 롤백)를
 * 고르고 → Upstage(OpenAI 호환, JSON mode) 또는 Anthropic을 호출 → 응답 텍스트를 `parseJsonLoose<T>`.
 * 실패 시 throw — 호출부의 기존 stub/error 폴백을 그대로 유지한다.
 *
 * @returns `data`(파싱된 T) + `model`(실제 사용 모델 id — model_version 문자열 재료).
 */
/**
 * provider 호출 에러를 분류 — 인증/키 오류(401·403)는 관리자가 알아볼 수 있는 한글 메시지로 바꿔
 * 다시 throw한다. 그래야 processing_error에 영문 원문 대신 "키를 고쳐라"가 떠 관리자가 조치할 수 있다.
 * (silent provider 폴백은 의도적으로 안 함 — 키가 무효면 표면에 드러나야 한다.)
 */
function rethrowAi(provider: AiProvider, err: unknown): never {
  const label =
    provider === "upstage"
      ? "Upstage(Solar)"
      : provider === "deepseek"
        ? "DeepSeek"
        : "Anthropic(Claude)";
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  // 🔴 잔액 소진을 **가장 먼저** 판정한다 — 키 오류·429보다 구체적이고, 조치가 다르다(갱신·대기가 아니라 **충전**).
  //    여기까지 왔다는 건 폴백 사다리의 provider가 전부 막혔다는 뜻이라, 원문 영문 대신 할 일을 한글로 말한다.
  if (isCreditExhaustedError(err)) {
    throw new Error(
      `AI 잔액 소진: ${label} 크레딧이 모두 소진되어 호출할 수 없습니다. 관리자가 해당 서비스에 크레딧을 충전해야 합니다.`,
    );
  }
  if (status === 401 || status === 403 || /invalid.*api key|unauthorized|api key/i.test(raw)) {
    throw new Error(
      `AI 키 오류: ${label} API 키가 유효하지 않습니다(${status ?? "인증 거부"}). 관리자가 환경변수의 AI API 키를 확인·갱신해야 합니다.`,
    );
  }
  if (status === 429) {
    throw new Error(`AI 사용량 한도 초과: ${label} 요청이 일시적으로 제한되었습니다(429). 잠시 후 다시 시도하세요.`);
  }
  throw err instanceof Error ? err : new Error(raw);
}

/**
 * provider 호출 에러의 사람이 읽는 본문 — SDK가 던지는 Error뿐 아니라 **plain object로 온 오류**도
 * `message`를 읽는다(`String(obj)`는 "[object Object]"라 어떤 판정에도 안 걸린다).
 */
function providerErrorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as { message?: unknown }).message ?? "");
  return String(err);
}

/** provider 호출 에러의 HTTP 상태코드(SDK가 status를 안 주면 undefined). */
function providerErrorStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status?: unknown }).status)
    : undefined;
}

/**
 * 크레딧·잔액 소진인가 — **폴백해야 마땅한데 상태코드가 400/402라 인증 오류로 안 잡히던** 구멍.
 *
 * 🔴 2026-08-27 프로덕션 사고: Anthropic 크레딧이 바닥나자 학부모 멘트 AI가 이틀간 **전건 실패**했다
 *    (8/27 77건·8/28 32건 모두 ok=false). 오류가 `400 invalid_request_error`
 *    ("Your credit balance is too low to access the Anthropic API")라 401/403/429만 보던
 *    `isRetryableProviderError`를 **통과하지 못해 다른 provider로 넘어가지 않았고**, 호출부는 곧장
 *    폴백 템플릿으로 떨어져 특이사항("내일 4시에 보강입니다")이 빠진 문구가 학부모 49명에게 나갔다.
 *    폴백 사다리(anthropic→deepseek→solar)는 그때도 있었다 — **이 판정 하나가 없어서 안 탔다.**
 *
 * ⚠️ provider마다 모양이 다르다: Anthropic=400 + "credit balance", DeepSeek=402 "Insufficient Balance",
 *    OpenAI 호환(Upstage)=429 + `insufficient_quota`. 그래서 **상태코드와 문구를 둘 다** 본다.
 * ⚠️ 오탐의 대가는 작다(다음 provider로 한 번 더 시도할 뿐) — 미탐은 이번처럼 기능이 조용히 죽는다.
 */
export function isCreditExhaustedError(err: unknown): boolean {
  if (providerErrorStatus(err) === 402) return true; // Payment Required(DeepSeek 잔액 0)
  return /credit balance|insufficient[\s_-]*(balance|quota|funds?|credits?)|(exceed|exceeded).{0,20}quota|purchase credits|payment required/i.test(
    providerErrorText(err),
  );
}

/** 다른 provider로 폴백할 가치가 있는 오류인가 — 인증(401/403)·한도(429)·**잔액 소진**, 또는 키 무효 메시지. */
export function isRetryableProviderError(err: unknown): boolean {
  const status = providerErrorStatus(err);
  if (status === 401 || status === 403 || status === 429) return true;
  if (isCreditExhaustedError(err)) return true;
  return /invalid.*api key|unauthorized|api key/i.test(providerErrorText(err));
}

/**
 * Anthropic 최신 모델(Claude 5 계열)이 temperature 파라미터를 거부하는 400인가 —
 * "`temperature` is deprecated for this model." (2026-07-17 비서 프로덕션 실측). 이 오류는
 * 모델 문제가 아니라 파라미터 문제라, temperature만 떼고 같은 모델로 1회 재시도하면 된다.
 */
export function isTemperatureDeprecatedError(err: unknown): boolean {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : String(err);
  return /temperature[\s\S]*deprecated/i.test(raw);
}

/** provider별 1회 호출 — 응답 텍스트+usage 반환(throw는 generateJSON 루프가 처리). */
async function callProvider(
  provider: AiProvider,
  model: string,
  keyName: AiKeyName,
  opts: GenerateJSONOptions,
): Promise<ProviderCall> {
  if (provider === "upstage") {
    const client = getUpstage(keyName);
    // 변수(리터럴 아님)로 만들어 reasoning_effort(Upstage 확장 파라미터, 표준 타입 밖)를 부착 —
    // 리터럴 직접 전달 시 excess-property 검사에 걸리므로 base 변수로 우회. non-stream 오버로드(res.choices) 유지.
    const base = {
      model,
      max_tokens: opts.maxTokens,
      // JSON mode — 프롬프트에 "JSON" 단어가 있어야 함(현 호출부 전부 "JSON만 출력" 포함).
      response_format: { type: "json_object" as const },
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.prompt },
      ],
    };
    const res = await client.chat.completions.create(base);
    return {
      text: res.choices[0]?.message?.content ?? "",
      usage: res.usage
        ? { inputTokens: res.usage.prompt_tokens ?? null, outputTokens: res.usage.completion_tokens ?? null }
        : null,
      truncated: res.choices[0]?.finish_reason === "length",
    };
  }
  if (provider === "deepseek") {
    const client = getDeepseek(keyName);
    // DeepSeek도 OpenAI 호환 — JSON mode 사용(프롬프트에 "JSON" 단어 필수, 현 호출부 충족). reasoning_effort는
    // DeepSeek 파라미터가 아니라 미부착. v4-pro(추론형)는 답을 content에, 사고과정을 reasoning_content에
    // 분리하므로 content 우선 + 비면 reasoning_content 폴백(빈 문자열이면 parseJsonLoose가 표면화).
    // ⚠️ **reasoning_content가 max_tokens를 함께 소모**한다(2026-07-16 실측: 등록상담 프롬프트에서 추론만
    // ~8k tok → 호출부 8192면 답변 JSON이 truncate돼 finish_reason=length → 파싱 실패 → 재분석 실패).
    // 그래서 추론+답변이 모두 들어가도록 여유 floor(DEEPSEEK_MIN_MAX_TOKENS)를 준다. max_tokens는 상한일 뿐
    // 실사용 토큰만 과금되므로(원장 지침) 넉넉히 둬도 비용 영향 없음(관측 실사용 ~5k~14k tok, v4-pro가 32000 수용).
    const res = await client.chat.completions.create({
      model,
      max_tokens: Math.max(opts.maxTokens, DEEPSEEK_MIN_MAX_TOKENS),
      response_format: { type: "json_object" as const },
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.prompt },
      ],
    });
    const msg = res.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    return {
      text: (msg?.content?.trim() ? msg.content : msg?.reasoning_content) ?? "",
      usage: res.usage
        ? { inputTokens: res.usage.prompt_tokens ?? null, outputTokens: res.usage.completion_tokens ?? null }
        : null,
      truncated: res.choices[0]?.finish_reason === "length",
    };
  }
  const client = getAnthropic(keyName);
  // document(PDF)가 있으면 content를 블록 배열로 — 문서 블록 + 텍스트 지시(비전 OCR 경로).
  const userContent = opts.document
    ? ([
        {
          type: "document" as const,
          source: {
            type: "base64" as const,
            media_type: opts.document.mediaType,
            data: opts.document.dataBase64,
          },
        },
        { type: "text" as const, text: opts.prompt },
      ] satisfies Anthropic.ContentBlockParam[])
    : opts.prompt;
  const anthropicParams = (withTemperature: boolean) => ({
    model,
    max_tokens: opts.maxTokens,
    ...(withTemperature && opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user" as const, content: userContent }],
  });
  // Claude 5 계열은 temperature가 deprecated(400) — 호출부의 temperature 지정(멘트 0.3 등)은
  // 지원 모델(Haiku 4.5 등)에선 유지하고, 거부하는 모델에서만 떼고 1회 재시도(자가 회복).
  const res = await client.messages.create(anthropicParams(true)).catch((e: unknown) => {
    if (opts.temperature == null || !isTemperatureDeprecatedError(e)) throw e;
    reportWarning("Anthropic temperature deprecated — 파라미터 제거 후 재시도", {
      scope: "generateJSON.temperature",
      model,
    });
    return client.messages.create(anthropicParams(false));
  });
  // content[0]만 보지 말고 모든 text 블록을 이어붙인다 — thinking 등 비-text 블록이 앞설 수 있어
  // 첫 블록만 읽으면 빈 문자열이 되는 모델(Sonnet 5 등)에서 파싱 실패("no json")가 난다.
  return {
    text: res.content.map((b) => (b.type === "text" ? b.text : "")).join(""),
    usage: res.usage
      ? { inputTokens: res.usage.input_tokens ?? null, outputTokens: res.usage.output_tokens ?? null }
      : null,
    truncated: res.stop_reason === "max_tokens",
  };
}

export async function generateJSON<T>(rawOpts: GenerateJSONOptions): Promise<{ data: T; model: string }> {
  // 🔴 사실 원칙(팩트·환각금지·창작금지·추측금지)은 **모든 AI 호출에 예외 없이** 붙는다(원장 2026-07-23).
  //    호출부 프롬프트가 아니라 이 단일 관문에 두는 이유·삭제 금지 사유는 fact-guard.ts 주석 참조
  //    (요약: 프롬프트 본문은 원장이 화면에서 편집 가능 = 가드가 지워질 수 있는 자리다).
  const opts: GenerateJSONOptions = { ...rawOpts, prompt: withFactGuard(rawOpts.prompt) };
  const tier = opts.tier ?? "balanced";
  const keyName = opts.keyName ?? "default";
  const chain = resolveModelChain(tier, keyName, opts.provider);
  // 키가 하나도 없으면 기존 동작 보존: 모델 있는 첫 candidate로 시도(클라 생성 시 키 없음 throw → rethrowAi).
  let candidates = chain.length > 0 ? chain : [resolveModel(tier, keyName, opts.provider)];
  if (opts.document) {
    // 문서(PDF) 입력은 Anthropic만 받는다 — 다른 provider로 폴백하면 첨부가 조용히 사라진 채
    // "본문 없음" 응답이 나와 원인을 못 찾는다. 후보를 한정하고, 없으면 키 문제를 그대로 말한다.
    candidates = candidates.filter((c) => c.provider === "anthropic");
    if (candidates.length === 0) {
      throw new Error("스캔 문서 인식은 Anthropic(Claude) API 키가 필요합니다 — 관리자가 ANTHROPIC_API_KEY를 확인하세요.");
    }
  }

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const { provider, model } = candidates[i];
    let call: ProviderCall | null = null;
    try {
      call = await callProvider(provider, model, keyName, opts);
    } catch (e) {
      lastErr = e;
      await recordUsage({
        meta: opts.meta,
        provider,
        model,
        keyName,
        ok: false,
        error: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
      });
      // 인증/한도 오류 + 다음 후보가 있으면 다른 provider로 폴백(B1: 무효·만료 키도 자동 회복).
      // 그 외(400·5xx) 또는 마지막 후보면 즉시 한글화해 표면화.
      if (i < candidates.length - 1 && isRetryableProviderError(e)) {
        reportWarning(`AI ${provider} 호출 실패 → 다른 provider로 폴백`, {
          scope: "generateJSON.fallback",
          provider,
          model,
          status: providerErrorStatus(e),
          // 잔액 소진은 저절로 안 풀린다(충전 전까지 매 호출 폴백) — 인증·한도와 구분해 로그에 남긴다.
          reason: isCreditExhaustedError(e) ? "credit_exhausted" : "auth_or_rate_limit",
        });
        continue;
      }
      rethrowAi(provider, e);
    }
    if (!call) continue; // 도달 불가(위 catch는 continue 또는 throw) — 타입 안전용
    // provider 호출 성공 = 토큰은 이미 소비됨 — 파싱 실패 여부와 무관하게 usage를 기록.
    await recordUsage({ meta: opts.meta, provider, model, keyName, usage: call.usage, ok: true });
    try {
      return { data: parseJsonLoose<T>(call.text), model };
    } catch (e) {
      // 잘린 응답의 파싱 실패는 "모델이 이상한 걸 뱉었다"가 아니라 "한도가 모자랐다"이다 —
      // 원인을 라우트·화면 오류 문구까지 그대로 들고 가야 max_tokens를 올릴 생각을 한다.
      if (call.truncated) {
        throw new Error(
          `AI 응답이 최대 길이(${opts.maxTokens} 토큰)에서 잘려 해석하지 못했습니다. 응답 한도를 늘리거나 요청을 줄여 주세요.`,
        );
      }
      throw e;
    }
  }
  // 도달 불가(루프가 항상 return 또는 throw) — 타입 종결용 terminator.
  rethrowAi(candidates[candidates.length - 1].provider, lastErr);
}
