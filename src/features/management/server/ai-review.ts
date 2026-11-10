import "server-only";
import { createHash } from "node:crypto";
import { generateJSON } from "@/lib/ai/generate";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/db-error";
import { ManagementInputError } from "../errors";
import { aiAnswerSchema, type AiReview } from "../ai-answer";
import { managementAccess } from "./access";
import { loadManagement } from "./query";

const SYSTEM = "학원 경영 검토 보조자다. 제공된 수치만 사용한다. null은 자료 없음이다. 청구액과 회계매출, 입금일 현금흐름을 구분한다. 상관관계를 인과관계로 단정하지 않는다. 채용·해고·강사별 학생배정은 판단하지 않는다. 지표에 없는 수치나 원인, 광고효과, 강사평가를 만들지 않는다. 인용은 제공된 metric id만 사용한다. JSON만 반환한다: {summary:string,findings:[{statement:string,kind:'관찰'|'가설',metricIds:string[],nextAction:string}],missingData:string[]}. 가설은 반드시 검증에 필요한 자료를 nextAction에 적는다. 한국어로 간결하게 쓴다.";

/** 그 달의 가장 최근 AI 검토(없으면 null). 화면은 이 값을 그대로 보여 주고, 다시 부르지 않는다. */
export async function loadLatestAiReview(tenantId: string, month: string): Promise<AiReview | null> {
  const r = await createAdminClient().from("management_ai_reviews").select("answer,model,created_at,facts_observed_at")
    .eq("tenant_id", tenantId).eq("month", month).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (r.error) { logDbError(r.error, "management.load_ai_review"); return null; }
  if (!r.data) return null;
  const answer = aiAnswerSchema.safeParse(r.data.answer);
  return answer.success ? { answer: answer.data, model: r.data.model, createdAt: r.data.created_at, factsObservedAt: r.data.facts_observed_at } : null;
}

/**
 * 원장이 'AI 검토'를 누를 때만 부른다(페이지 로드에서 부르지 않는다). AI에 보내는 것 = 선택 월의 집계 지표·산식·청구 증감 분해뿐 —
 * 학생·직원 이름, 상담 원문, 개인별 급여, 확인 메모는 보내지 않는다. 결과는 s2_0072 표에 남긴다.
 */
export async function runManagementAiReview(month: string): Promise<AiReview> {
  const user = await managementAccess(true);
  const data = await loadManagement(month);
  const facts = { month: data.month, asOf: data.asOf, metrics: data.metrics.map(({ id, label, value, unit, definition }) => ({ id, label, value, unit, definition })), billingChange: data.bridge };
  const prompt = JSON.stringify(facts);
  const generated = await generateJSON<unknown>({
    meta: { feature: "management_analysis", tenantId: user.tenantId },
    tier: "balanced", provider: "anthropic", allowedProviders: ["anthropic"], maxTokens: 4000, reasoningEffort: "low",
    signal: AbortSignal.timeout(50_000), system: SYSTEM, prompt,
  });
  const parsed = aiAnswerSchema.safeParse(generated.data);
  const ids = new Set(data.metrics.map((m) => m.id));
  if (!parsed.success || parsed.data.findings.some((f) => f.metricIds.some((id) => !ids.has(id)))) throw new ManagementInputError("AI 답변이 제공한 지표와 맞지 않아 저장하지 않았습니다. 다시 시도해 주세요.");
  const row = { tenant_id: user.tenantId, month: data.month, answer: parsed.data, model: generated.model, facts_hash: createHash("sha256").update(prompt).digest("hex"), facts_observed_at: data.observedAt, created_by: user.id };
  const saved = await createAdminClient().from("management_ai_reviews").insert(row).select("created_at").single();
  if (saved.error) { logDbError(saved.error, "management.save_ai_review"); throw new ManagementInputError("AI 검토 결과를 저장하지 못했습니다. 다시 시도해 주세요."); }
  return { answer: parsed.data, model: generated.model, createdAt: saved.data.created_at, factsObservedAt: data.observedAt };
}
