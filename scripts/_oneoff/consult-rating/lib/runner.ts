// 상담 평점 평가 단계 공용 실행기(2026-11-11) — 앱 밖 일회성 시험·일괄 평점 전용. 운영 앱에서 import하지 않는다.
// ai-credit-mvp/lib/runner.ts(수업보고서 평점 시험 실행기)에서 **내부 요금제(구독 CLI) 전용**으로 줄여 옮겼다 — 원장 2026-11-11
// *"지금 업로드된 상담들은 전부 내부 요금제로"* · 메모리 '테스트 = 내부 요금제'. 외부 API 키는 이 파일 어디서도 읽지 않는다.
// ⚠️ 이 폴더 스크립트는 .ts(CJS)로 둔다 — .mts(ESM)에서 부르면 앱 모듈(dev-cli)이 두 벌 실려 관찰자 기록이 끊긴다.
// 모든 호출은 generateJSON()을 그대로 지난다(사실 원칙 FACT_GUARD · 지점 식별 · 모델 지정 · 개발 CLI 갈래) — 운영 배치와 같은 지침·프롬프트.
// 🔴 운영 DB·Supabase·API 키 환경변수가 있으면 시작하지 않는다(있으면 generateJSON이 운영 ai_usage_logs에 쓰거나 키로 과금한다).
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generateJSON } from "@/lib/ai/generate";
import { devCliTrace, type DevCliTrace } from "@/lib/ai/dev-cli";

export const RESULT_ROOT = join(homedir(), "eywa-data", "consult-rating");
export const USAGE_LEDGER = join(RESULT_ROOT, "02-harness", "usage.jsonl");
export const MODELS = { haiku: "claude-haiku-5-5", sonnet: "claude-sonnet-5-5" } as const;
export type ModelKey = keyof typeof MODELS;
const FORBIDDEN_ENV = /^(DATABASE_URL|SUPABASE_|NEXT_PUBLIC_SUPABASE_|DEEPSEEK_API_KEY|OPENAI_API_KEY|ANTHROPIC_)/;

export function assertEvalEnv(): void {
  const bad = Object.keys(process.env).filter((k) => FORBIDDEN_ENV.test(k));
  if (bad.length) throw new Error(`평가 단계에 실으면 안 되는 환경변수: ${bad.join(", ")} — 추출·전달과 평가를 나눌 것`);
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("운영 환경에서는 돌리지 않는다");
  if (process.env.AI_DEV_CLAUDE_CLI !== "1") throw new Error("구독 CLI 경로는 AI_DEV_CLAUDE_CLI=1이 필요하다");
}

/** 라이선스 조회 실패 안내(평가 단계는 Supabase가 없어 늘 '허용'으로 지나간다)만 감춘다. */
const origError = console.error;
console.error = (...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[license]")) return; origError(...a); };

// 동시 실행 제한(같은 구독을 다른 세션도 쓴다 — 3~4개 이하).
let running = 0;
const waiters: (() => void)[] = [];
async function slot<T>(limit: number, fn: () => Promise<T>): Promise<T> {
  while (running >= limit) await new Promise<void>((r) => waiters.push(r));
  running++;
  try { return await fn(); } finally { running--; waiters.shift()?.(); }
}

export type CallInput = {
  task: string; version: string; item: string; model: ModelKey;
  prompt: string; system?: string; maxTokens: number; effort?: "low" | "medium" | "high";
  feature: string; tenantId: string; cacheDir: string; concurrency?: number;
  /** 같은 입력을 다시 판정(흔들림 측정) — 1 이상이면 캐시 열쇠에만 들어간다(프롬프트는 같다). */
  rep?: number;
  /** 캐시만 쓴다 — 아직 안 매긴 건은 부르지 않고 '캐시 없음'으로 돌려준다(다른 실행이 매기는 중일 때 중간 결과만 뽑으려고). */
  cacheOnly?: boolean;
};
export type CallResult<T> = { ok: true; data: T; model: string; actualModels: string[]; ms: number; cached: boolean } | { ok: false; error: string; ms: number; cached: false };

export async function callModel<T>(c: CallInput): Promise<CallResult<T>> {
  const requested = MODELS[c.model];
  const key = ["cli", requested, c.effort ?? null, c.system ?? "", c.prompt, ...(c.rep ? [`rep${c.rep}`] : [])];
  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
  mkdirSync(c.cacheDir, { recursive: true });
  const cacheFile = join(c.cacheDir, `${hash}.json`);
  if (existsSync(cacheFile)) {
    const hit = JSON.parse(readFileSync(cacheFile, "utf8"));
    ledger({ ...c, requested, hash, cached: true, ok: true, ms: 0, actualModels: hit.actualModels });
    return { ok: true, data: hit.data as T, model: hit.model, actualModels: hit.actualModels, ms: hit.ms, cached: true };
  }
  if (c.cacheOnly) return { ok: false, error: "캐시 없음(아직 안 매김)", ms: 0, cached: false };
  return slot(Math.min(c.concurrency ?? 3, 4), async () => {
    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const t0 = Date.now();
      // 관찰자가 콜백에서 채운다 — 상자에 담아야 타입 좁히기가 'null 그대로'로 굳지 않는다.
      const box: { trace: DevCliTrace | null } = { trace: null };
      try {
        const res = await devCliTrace.run((t) => { box.trace = t; }, () => generateJSON<T>({
          prompt: c.prompt, system: c.system, maxTokens: c.maxTokens, provider: "anthropic",
          tier: c.model === "haiku" ? "fast" : "balanced", reasoningEffort: c.effort, cacheSystem: !!c.system,
          meta: { feature: c.feature, tenantId: c.tenantId },
        }));
        const ms = Date.now() - t0;
        const actualModels = box.trace?.models ?? [];
        // 실제 응답 모델이 요청 모델이 아니면 그 결과로 치지 않는다(폴백 응답 배제).
        if (!actualModels.length || actualModels.some((m) => m !== requested)) {
          lastErr = `응답 모델 불일치: 요청 ${requested} · 실제 ${actualModels.join("+") || "확인 못 함"}`;
          ledger({ ...c, requested, hash, cached: false, ok: false, ms, actualModels, error: lastErr, trace: box.trace });
          continue;
        }
        ledger({ ...c, requested, hash, cached: false, ok: true, ms, actualModels, trace: box.trace });
        writeFileSync(cacheFile, JSON.stringify({ data: res.data, model: res.model, actualModels, ms, at: new Date().toISOString() }));
        return { ok: true as const, data: res.data, model: res.model, actualModels, ms, cached: false as const };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        ledger({ ...c, requested, hash, cached: false, ok: false, ms: Date.now() - t0, actualModels: [], error: lastErr.slice(0, 300), trace: box.trace });
        if (/429|rate|limit|overloaded/i.test(lastErr)) await new Promise((r) => setTimeout(r, 60_000 * attempt));
      }
    }
    return { ok: false as const, error: lastErr, ms: 0, cached: false as const };
  });
}

function ledger(x: Record<string, unknown> & { prompt?: string; system?: string; cacheDir?: string }): void {
  // 원장부에는 프롬프트·지침·캐시 경로를 남기지 않는다(원문은 캐시 파일에만).
  const rest: Record<string, unknown> = { ...x };
  for (const k of ["prompt", "system", "cacheDir", "trace"]) delete rest[k];
  const t = (x.trace ?? {}) as Partial<DevCliTrace>;
  mkdirSync(join(RESULT_ROOT, "02-harness"), { recursive: true });
  appendFileSync(USAGE_LEDGER, JSON.stringify({
    at: new Date().toISOString(), ...rest,
    inputTokens: t.inputTokens ?? null, outputTokens: t.outputTokens ?? null, cacheReadTokens: t.cacheReadTokens ?? null,
    cacheWriteTokens: t.cacheWriteTokens ?? null, listCostUsd: t.listCostUsd ?? null,
  }) + "\n");
}
