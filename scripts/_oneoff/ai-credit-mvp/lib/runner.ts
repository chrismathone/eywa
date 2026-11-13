// 크레딧 MVP 평가 단계 공용 실행기(2026-10-26) — 앱 밖 일회성 시험 전용. 운영 앱에서 import하지 않는다.
// ⚠️ 이 폴더 스크립트는 .ts(CJS)로 둔다 — .mts(ESM)에서 부르면 앱 모듈(dev-cli)이 두 벌 실려 관찰자 기록이 끊긴다(2026-10-26 실측).
// 모든 호출은 generateJSON()을 그대로 지난다(사실 원칙 FACT_GUARD · 지점 식별 · 모델 지정 · 개발 CLI 갈래).
//  · mode "cli"(기본) = 내부 요금제(구독 CLI) — AI_DEV_CLAUDE_CLI=1. 횟수 제한 없음(원장 10-26).
//  · mode "api" = 실제 API — 상한 $5(장부 합계로 막는다). Anthropic 키만 싣고 OpenAI 키는 금지해 폴백 과금을 막는다.
// 🔴 운영 DB·Supabase 환경변수가 있으면 시작하지 않는다(있으면 generateJSON이 운영 ai_usage_logs에 쓴다).
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateJSON } from "@/lib/ai/generate";
import { devCliTrace, type DevCliTrace } from "@/lib/ai/dev-cli";

export const RESULT_ROOT = "D:/tmp/ai-credit-mvp-2026-10-26";
export const USAGE_LEDGER = join(RESULT_ROOT, "02-harness", "usage.jsonl");
export const API_CAP_USD = 5;
export const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5" } as const;
// 정가(100만 토큰당 $ · 2026-10 공식 가격표). 캐시 읽기 10% · 쓰기 125%.
const PRICE: Record<string, { in: number; out: number }> = { [MODELS.haiku]: { in: 0.1, out: 0.5 }, [MODELS.sonnet]: { in: 2, out: 10 } };

export type Mode = "cli" | "api";
const FORBIDDEN_ENV = /^(DATABASE_URL|SUPABASE_|NEXT_PUBLIC_SUPABASE_|DEEPSEEK_API_KEY|OPENAI_API_KEY)/;

export function assertEvalEnv(mode: Mode): void {
  const bad = Object.keys(process.env).filter((k) => FORBIDDEN_ENV.test(k));
  if (bad.length) throw new Error(`평가 단계에 실으면 안 되는 환경변수: ${bad.join(", ")} — 추출과 평가를 나눌 것`);
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("운영 환경에서는 돌리지 않는다");
  if (mode === "cli" && process.env.AI_DEV_CLAUDE_CLI !== "1") throw new Error("cli 모드는 AI_DEV_CLAUDE_CLI=1이 필요하다");
  if (mode === "api") {
    if (process.env.AI_DEV_CLAUDE_CLI) throw new Error("api 모드에서는 AI_DEV_CLAUDE_CLI를 끈다");
    // 앱이 쓰는 키(기본·그룹)만 싣는다 — 값은 출력하지 않는다.
    const text = readFileSync("D:/eywa_refactoring/.env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^(ANTHROPIC_API_KEY[A-Z_]*)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "").trim();
    }
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY를 찾지 못했다");
  }
}

/** 라이선스 조회 실패 안내(평가 단계는 Supabase가 없어 늘 '허용'으로 지나간다 — 침산 라이선스는 추출 때 따로 기록)만 감춘다. */
const origError = console.error;
console.error = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[license]")) return; origError(...a); };

// API 응답의 실제 모델·토큰을 잡는 관찰자 — SDK는 전역 fetch를 쓴다.
type ApiTrace = { models: string[]; inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null };
const apiTrace = new AsyncLocalStorage<(t: ApiTrace) => void>();
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await origFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const observe = apiTrace.getStore();
  if (observe && /api\.anthropic\.com\/v1\/messages/.test(url) && res.ok) {
    try {
      const j = (await res.clone().json()) as { model?: string; usage?: Record<string, number> };
      observe({ models: j.model ? [j.model] : [], inputTokens: j.usage?.input_tokens ?? null, outputTokens: j.usage?.output_tokens ?? null,
        cacheReadTokens: j.usage?.cache_read_input_tokens ?? null, cacheWriteTokens: j.usage?.cache_creation_input_tokens ?? null });
    } catch { /* 기록 실패는 호출을 막지 않는다 */ }
  }
  return res;
}) as typeof fetch;

export function costUsd(model: string, t: Partial<ApiTrace>): number {
  const p = PRICE[model];
  if (!p) return 0;
  const m = 1e6;
  return ((t.inputTokens ?? 0) * p.in + (t.cacheReadTokens ?? 0) * p.in * 0.1 + (t.cacheWriteTokens ?? 0) * p.in * 1.25 + (t.outputTokens ?? 0) * p.out) / m;
}

export function apiSpentUsd(): number {
  if (!existsSync(USAGE_LEDGER)) return 0;
  return readFileSync(USAGE_LEDGER, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((x) => x.mode === "api" && !x.cached).reduce((a, x) => a + (x.costUsd ?? 0), 0);
}

// 동시 실행 제한(같은 구독을 다른 세션도 쓴다 — 3~4개 이하).
let running = 0;
const waiters: (() => void)[] = [];
async function slot<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  while (running >= limit) await new Promise<void>((r) => waiters.push(r));
  running++;
  try { return await fn(); } finally { running--; waiters.shift()?.(); }
}

export type CallInput = {
  task: string; version: string; item: string; mode: Mode; model: keyof typeof MODELS;
  prompt: string; system?: string; maxTokens: number; effort?: "low" | "medium" | "high";
  feature: string; tenantId: string; cacheDir: string; concurrency?: number;
  /** 같은 입력을 다시 판정(흔들림 측정·2회 합의) — 1 이상이면 캐시 열쇠에만 들어간다(프롬프트는 같다). */
  rep?: number;
};
export type CallResult<T> = { ok: true; data: T; model: string; actualModels: string[]; ms: number; cached: boolean } | { ok: false; error: string; ms: number; cached: false };

export async function callModel<T>(c: CallInput): Promise<CallResult<T>> {
  const requested = MODELS[c.model];
  const key = [c.mode, requested, c.effort ?? null, c.system ?? "", c.prompt, ...(c.rep ? [`rep${c.rep}`] : [])];
  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
  mkdirSync(c.cacheDir, { recursive: true });
  const cacheFile = join(c.cacheDir, `${hash}.json`);
  if (existsSync(cacheFile)) {
    const hit = JSON.parse(readFileSync(cacheFile, "utf8"));
    ledger({ ...c, requested, hash, cached: true, ok: true, ms: 0, actualModels: hit.actualModels });
    return { ok: true, data: hit.data as T, model: hit.model, actualModels: hit.actualModels, ms: hit.ms, cached: true };
  }
  return slot(Math.min(c.concurrency ?? 3, 4), async () => {
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (c.mode === "api" && apiSpentUsd() >= API_CAP_USD - 0.25) throw new Error(`API 상한 $${API_CAP_USD} 근접 — 멈춤`);
      const t0 = Date.now();
      // 관찰자가 콜백에서 채운다 — 상자에 담아야 타입 좁히기가 'null 그대로'로 굳지 않는다.
      const box: { trace: (DevCliTrace & Partial<ApiTrace>) | ApiTrace | null } = { trace: null };
      try {
        const run = () => generateJSON<T>({
          prompt: c.prompt, system: c.system, maxTokens: c.maxTokens, provider: "anthropic",
          tier: c.model === "haiku" ? "fast" : "balanced", reasoningEffort: c.effort, cacheSystem: !!c.system,
          meta: { feature: c.feature, tenantId: c.tenantId },
        });
        const res = c.mode === "cli"
          ? await devCliTrace.run((t) => { box.trace = t; }, run)
          : await apiTrace.run((t) => { box.trace = t; }, run);
        const ms = Date.now() - t0;
        const trace = box.trace;
        const actualModels = trace?.models ?? [];
        // 실제 응답 모델이 요청 모델이 아니면 그 결과로 치지 않는다(폴백 응답 배제).
        if (!actualModels.length || actualModels.some((m) => m !== requested)) {
          lastErr = `응답 모델 불일치: 요청 ${requested} · 실제 ${actualModels.join("+") || "확인 못 함"}`;
          ledger({ ...c, requested, hash, cached: false, ok: false, ms, actualModels, error: lastErr, trace });
          continue;
        }
        const cost = c.mode === "api" && trace ? costUsd(requested, trace) : 0;
        ledger({ ...c, requested, hash, cached: false, ok: true, ms, actualModels, trace, costUsd: cost });
        writeFileSync(cacheFile, JSON.stringify({ data: res.data, model: res.model, actualModels, ms, at: new Date().toISOString() }));
        return { ok: true as const, data: res.data, model: res.model, actualModels, ms, cached: false };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        ledger({ ...c, requested, hash, cached: false, ok: false, ms: Date.now() - t0, actualModels: [], error: lastErr.slice(0, 300), trace: box.trace });
        if (/429|rate|limit|overloaded/i.test(lastErr)) await new Promise((r) => setTimeout(r, 60_000 * attempt));
      }
    }
    return { ok: false as const, error: lastErr, ms: 0, cached: false as const };
  });
}

function ledger(x: Record<string, unknown> & { prompt?: string; system?: string }): void {
  const { prompt: _p, system: _s, cacheDir: _d, ...rest } = x;
  const t = (x.trace ?? {}) as Partial<DevCliTrace & ApiTrace>;
  mkdirSync(join(RESULT_ROOT, "02-harness"), { recursive: true });
  appendFileSync(USAGE_LEDGER, JSON.stringify({
    at: new Date().toISOString(), ...rest, trace: undefined,
    inputTokens: t.inputTokens ?? null, outputTokens: t.outputTokens ?? null, cacheReadTokens: t.cacheReadTokens ?? null,
    cacheWriteTokens: t.cacheWriteTokens ?? null, listCostUsd: (t as DevCliTrace).listCostUsd ?? null,
  }) + "\n");
}
