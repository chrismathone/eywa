/**
 * 밤 배치(Anthropic Message Batches · 일반 호출의 50% 값) — `generateJSON`과 **같은 관문**을 지난다(원장 2026-10-20 "배치로 진행").
 * 단일 진입점 원칙(CLAUDE.md 'AI 모델 정책')을 지키려고 같은 폴더에 둔다: 사실 원칙(FACT_GUARD) · 지점 라이선스 · 기능별 키 그룹 ·
 * 모델 고정(지점 선택 > 코드 기본) · 요청 본문(`anthropicRequestParams`) · 사용량 기록(`recordUsage`) 전부 generate.ts의 것을 그대로 쓴다.
 *
 * - 배치는 **Anthropic 전용**이다(OpenAI에는 이 경로와 같은 할인 배치를 쓰지 않는다). 고정 모델이 다른 회사면 그 항목은 거절해 즉시 호출로 돌린다.
 * - 한 배치는 한 키 그룹만 담는다(키가 하나여야 한다). 섞어 넣으면 던진다.
 * - 결과는 24시간 안에 온다. 수거(`collectJSONBatch`)는 끝나지 않았으면 null — 다음 cron이 다시 묻는다.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFactGuard } from "./fact-guard";
import { devCliEnabled, runDevCli } from "./dev-cli";
import { getAnthropic } from "./anthropic";
import { featurePin } from "./model-pins";
import { AI_MODELS, keyGroupOf, keyLabelOf, resolveKeyEnv } from "./models";
import {
  anthropicRequestParams,
  anthropicUsage,
  parseJsonLoose,
  recordUsage,
  requireAiLicense,
  tenantChoiceFor,
  type GenerateJSONOptions,
} from "./generate";

export type BatchItem = { customId: string; opts: GenerateJSONOptions };
export type BatchSubmitted = {
  batchId: string;
  /** customId → 실제로 실은 모델(수거 때 사용량 기록·결과 표시에 쓴다). */
  models: Record<string, string>;
  /** 라이선스·회사 문제로 싣지 못한 항목(즉시 호출로 돌리거나 다음 밤에). */
  rejected: { customId: string; error: string }[];
};
export type BatchOutcome = { ok: true; data: unknown; model: string } | { ok: false; error: string };

/** custom_id 규칙(Anthropic: 영문·숫자·_- 1~64자). */
export const BATCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export async function submitJSONBatch(items: readonly BatchItem[]): Promise<BatchSubmitted | null> {
  const groups = new Set(items.map((i) => keyGroupOf(i.opts.meta.feature)));
  if (groups.size > 1) throw new Error("한 배치에는 같은 키 그룹의 기능만 담는다");
  const group = [...groups][0] ?? null;
  const models: Record<string, string> = {};
  const rejected: BatchSubmitted["rejected"] = [];
  const requests: { custom_id: string; params: ReturnType<typeof anthropicRequestParams> }[] = [];
  for (const item of items) {
    if (!BATCH_ID_RE.test(item.customId)) { rejected.push({ customId: item.customId, error: "배치 항목 이름 형식 오류" }); continue; }
    try {
      await requireAiLicense(item.opts.meta);
      const pin = featurePin(item.opts.meta.feature, await tenantChoiceFor(item.opts.meta));
      const model = pin?.provider === "anthropic" ? pin.model : pin ? null : AI_MODELS[item.opts.tier ?? "balanced"].anthropic;
      if (!model) { rejected.push({ customId: item.customId, error: "배치는 Claude 모델만 실을 수 있습니다" }); continue; }
      const opts: GenerateJSONOptions = { ...item.opts, prompt: withFactGuard(item.opts.prompt) };
      requests.push({ custom_id: item.customId, params: anthropicRequestParams(model, opts, false) });
      models[item.customId] = model;
    } catch (e) {
      rejected.push({ customId: item.customId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (requests.length === 0) return rejected.length ? { batchId: "", models, rejected } : null;
  if (devCliEnabled()) return { batchId: await runDevBatch(requests), models, rejected };
  const batch = await getAnthropic("default", group).messages.batches.create({ requests });
  return { batchId: batch.id, models, rejected };
}

/**
 * 배치 결과 수거 — 아직 처리 중이면 null. 끝났으면 customId별 결과(파싱한 JSON 또는 한글 오류)를 돌려주고,
 * 성공·실패 모두 사용량을 기록한다(배치 값은 일반의 절반이지만 토큰 수는 그대로 남긴다 — 표시는 key_name 'batch:<키>').
 */
export async function collectJSONBatch(
  batchId: string,
  metas: Readonly<Record<string, GenerateJSONOptions["meta"]>>,
): Promise<Record<string, BatchOutcome> | null> {
  if (batchId.startsWith(DEV_BATCH_PREFIX)) return collectDevBatch(batchId, metas);
  const anyMeta = Object.values(metas)[0];
  const group = keyGroupOf(anyMeta?.feature);
  const client = getAnthropic("default", group);
  const status = await client.messages.batches.retrieve(batchId);
  if (status.processing_status !== "ended") return null;
  const keyName = `batch:${keyLabelOf("anthropic", resolveKeyEnv("anthropic", "default", group))}`;
  const out: Record<string, BatchOutcome> = {};
  for await (const row of await client.messages.batches.results(batchId)) {
    const meta = metas[row.custom_id];
    if (!meta) continue;
    if (row.result.type !== "succeeded") {
      const error = row.result.type === "errored" ? `배치 항목 실패: ${row.result.error.error?.type ?? "오류"}` : `배치 항목 ${row.result.type === "expired" ? "만료" : "취소"}`;
      out[row.custom_id] = { ok: false, error };
      await recordUsage({ meta, provider: "anthropic", model: "batch", keyName, ok: false, error });
      continue;
    }
    const msg = row.result.message;
    await recordUsage({ meta, provider: "anthropic", model: msg.model, keyName, usage: anthropicUsage(msg.usage), ok: true });
    if (msg.stop_reason === "refusal") { out[row.custom_id] = { ok: false, error: "AI가 이 요청을 거절했습니다" }; continue; }
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    try {
      out[row.custom_id] = { ok: true, data: parseJsonLoose(text), model: msg.model };
    } catch {
      out[row.custom_id] = { ok: false, error: msg.stop_reason === "max_tokens" ? "AI 응답이 최대 길이에서 잘렸습니다" : "AI 응답을 해석하지 못했습니다" };
    }
  }
  return out;
}

// ── 개발 전용 배치(dev-cli.ts) — 운영에선 안 탄다. 한 건씩 바로 CLI로 돌려 결과를 임시 파일에 두고, 수거가 그 파일을 읽는다. ──
const DEV_BATCH_PREFIX = "devcli_";
const devBatchDir = () => join(tmpdir(), "aywa-dev-batches");

type DevParams = ReturnType<typeof anthropicRequestParams>;
/** system은 문자열 또는(캐시 지점이 있으면) 텍스트 블록 배열 — CLI엔 글만 넘긴다(캐시 표시는 CLI에 없다). */
const systemText = (s: DevParams["system"]): string | undefined =>
  typeof s === "string" ? s : Array.isArray(s) ? s.map((b) => (b.type === "text" ? b.text : "")).join("\n") : undefined;

/** 시험용으로 연다 — 캐시 글(cachePrefix) 블록은 텍스트라 prompt 앞에 차례대로 이어진다. */
export function devInput(params: DevParams) {
  const content = params.messages[0]?.content;
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : (content as { type: string; text?: string; source?: { media_type: string; data: string } }[]);
  const images: { mediaType: string; dataBase64: string; label?: string }[] = [];
  let pendingLabel: string | undefined;
  let prompt = "";
  for (const b of blocks) {
    if (b.type === "document") throw new Error("개발용 CLI 배치는 문서(PDF) 첨부를 지원하지 않습니다");
    if (b.type === "image" && b.source) { images.push({ mediaType: b.source.media_type, dataBase64: b.source.data, label: pendingLabel }); pendingLabel = undefined; }
    else if (b.type === "text") { if (pendingLabel !== undefined) prompt += `${pendingLabel}\n`; pendingLabel = b.text; }
  }
  if (pendingLabel !== undefined) prompt += pendingLabel;
  return { model: params.model, prompt, system: systemText(params.system), images };
}

/** 개발 CLI를 나란히 돌리는 수 — 한 건에 1분쯤이라 밀린 영상 수백 건을 하루 안에 끝내려면 몇 개는 겹쳐야 한다(원장 2026-10-21 "전부 분석해버려"). */
const DEV_BATCH_CONCURRENCY = 3;

async function runDevBatch(requests: { custom_id: string; params: DevParams }[]): Promise<string> {
  const id = `${DEV_BATCH_PREFIX}${randomUUID().replace(/-/g, "")}`;
  const out: Record<string, { ok: true; text: string; model: string } | { ok: false; error: string }> = {};
  let next = 0;
  const lane = async () => {
    while (next < requests.length) {
      const r = requests[next++];
      try { out[r.custom_id] = { ok: true, text: await runDevCli(devInput(r.params)), model: r.params.model }; }
      catch (e) { out[r.custom_id] = { ok: false, error: e instanceof Error ? e.message : String(e) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DEV_BATCH_CONCURRENCY, requests.length) }, lane));
  await mkdir(devBatchDir(), { recursive: true });
  await writeFile(join(devBatchDir(), `${id}.json`), JSON.stringify(out));
  return id;
}

async function collectDevBatch(batchId: string, metas: Readonly<Record<string, GenerateJSONOptions["meta"]>>): Promise<Record<string, BatchOutcome> | null> {
  if (!devCliEnabled()) throw new Error("개발 배치 번호는 개발 서버에서만 수거합니다");
  if (!/^devcli_[a-f0-9]{32}$/.test(batchId)) throw new Error("개발 배치 번호 형식 오류");
  const saved = JSON.parse(await readFile(join(devBatchDir(), `${batchId}.json`), "utf8")) as Record<string, { ok: boolean; text?: string; model?: string; error?: string }>;
  const out: Record<string, BatchOutcome> = {};
  for (const [customId, meta] of Object.entries(metas)) {
    const r = saved[customId];
    if (!r) continue;
    await recordUsage({ meta, provider: "anthropic", model: r.model ?? "dev-cli", keyName: "dev-cli", ok: r.ok, error: r.error });
    if (!r.ok || !r.text) { out[customId] = { ok: false, error: r.error ?? "개발 배치 실패" }; continue; }
    try { out[customId] = { ok: true, data: parseJsonLoose(r.text), model: r.model ?? "dev-cli" }; }
    catch { out[customId] = { ok: false, error: "AI 응답을 해석하지 못했습니다" }; }
  }
  return out;
}
