import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import {
  applyParentAddress,
  buildFallbackPrepBrief,
  buildPrepBriefPrompt,
  validatePrepBrief,
  type PrepBriefRecord,
  type PrepFacts,
} from "@/features/enrollment/prep-brief";
import { collectPrepFacts } from "@/features/enrollment/server/prep-facts";
import { isFeatureLicensed } from "@/lib/license/server";
import { PREP_BRIEF_STALL_MS } from "@/features/enrollment/prep-stall";

/**
 * 브리프 생성 본체 — **server-only 모듈**이다("use server" 아님).
 *
 * ⚠️ 이 함수들을 서버 액션 파일에 두면 안 된다: `"use server"` 모듈의 **모든 export는 클라이언트가
 *    호출 가능한 엔드포인트**가 되어, `generatePrepBriefOnIntake(임의 상담id, 임의 tenantId)`를
 *    외부에서 그대로 부를 수 있다(권한 게이트 없는 크로스테넌트 생성). 게이트가 붙은 액션만
 *    `prep-actions.ts`에 남기고, 본체는 여기로 분리한다.
 */

type Client = ReturnType<typeof createAdminClient> | Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

/**
 * 생성 작업을 연다 — 진행 중인 작업(시작 240초 안)이 있으면 null. 열면 작업 시각(이 작업의 표)을 돌려준다.
 * 🔴 끝날 때 같은 시각일 때만 결과·상태를 쓴다(`runPrepBriefGeneration`) — 늦게 끝난 옛 작업이 새 결과를 덮지 않게(검수 2026-11-11 ·
 *    Claude·Codex 합의 · s2_0068). 멈춘 작업(240초 넘음 · 시각 없는 옛 작업)은 새 작업으로 갈아탄다.
 */
export async function claimPrepBriefJob(client: Client, consultationId: string): Promise<string | null> {
  const now = Date.now();
  const jobAt = new Date(now).toISOString();
  const staleBefore = new Date(now - PREP_BRIEF_STALL_MS).toISOString();
  const { data, error } = await client
    .from("enrollment_consultations")
    .update({ prep_brief_status: "generating", prep_brief_error: null, prep_brief_job_at: jobAt })
    .eq("id", consultationId)
    .or(`prep_brief_status.is.null,prep_brief_status.neq.generating,prep_brief_job_at.is.null,prep_brief_job_at.lt.${staleBefore}`)
    .select("id");
  if (error) throw error;
  return data && data.length > 0 ? jobAt : null;
}

/**
 * 수기 버튼과 학부모 QR 제출 자동 생성이 공유하는 실행 본체(프롬프트·검증·폴백 중복 금지).
 * 저장은 항상 admin client — after() 안에서는 요청 컨텍스트(쿠키)가 없다. `jobAt` = `claimPrepBriefJob`이 연 작업.
 */
export async function runPrepBriefGeneration(
  consultationId: string,
  facts: PrepFacts,
  tenantId: string,
  jobAt: string,
): Promise<void> {
  const admin = createAdminClient();
  const base = { version: 1 as const, generatedAt: new Date().toISOString(), facts };
  let record: PrepBriefRecord;
  try {
    const call = () =>
      generateJSON<unknown>({
        // 응답 상한은 generateJSON이 바닥값(Claude 5 계열 64,000)으로 올린다 — 생각 토큰까지 들어가게.
        maxTokens: 8192,
        provider: "anthropic", // 2026-10-26 원장 결정 — Sonnet 5.5(기본 등급)
        meta: { feature: "enrollment_prep_brief", tenantId },
        prompt: buildPrepBriefPrompt(facts),
      });
    // 모델이 JSON을 깨뜨리면(재생성 59건 중 3건 — 쉼표·따옴표를 잘못 닫음) 한 번만 다시 부른다(검수 2026-11-11).
    const { data, model } = await call().catch((e: unknown) => {
      if (e instanceof SyntaxError || (e instanceof Error && /JSON/.test(e.message))) {
        console.warn("[prep-brief] JSON이 깨져 한 번 더 부름", e.message);
        return call();
      }
      throw e;
    });
    const checked = validatePrepBrief(data, facts);
    // 호칭 후처리는 검증 **뒤**에 — 한글 이름을 호칭으로 바꾸는 치환이라 grounding(숫자·영문)에 영향 없다.
    record = checked.ok
      ? { ...base, source: "ai", model, brief: applyParentAddress(checked.value, facts), ...(checked.repairs.length ? { repairs: checked.repairs } : {}),
          ...(checked.observations.length ? { observations: checked.observations } : {}) }
      : {
          ...base,
          source: "fallback",
          fallbackReason: checked.reason,
          model,
          brief: buildFallbackPrepBrief(facts),
        };
    if (!checked.ok) console.warn("[prep-brief] 검증 탈락 → 폴백", checked.reason);
    else if (checked.repairs.length) console.warn("[prep-brief] 검증이 고친 곳", checked.repairs.join(" | "));
    if (checked.ok && checked.observations.length) console.info("[prep-brief] 말투 관찰(고치지 않음)", checked.observations.join(" | "));
  } catch (e) {
    // 원문은 서버 로그로만(UI에 기술 원문 노출 금지) — 화면엔 폴백 브리프 + '기본 브리프' 표시.
    console.error("[prep-brief] AI 생성 실패", e);
    record = {
      ...base,
      source: "fallback",
      fallbackReason: "AI 호출 실패",
      model: null,
      brief: buildFallbackPrepBrief(facts),
    };
  }

  // 🔴 새 결과가 폴백인데 직전 AI 브리프가 있으면 덮지 않는다 — 예전엔 일시 장애·검증 탈락 한 번에 멀쩡한 AI 브리프가 기본 브리프로
  //    바뀌었다(검수 2026-11-11). 이전 브리프를 그대로 두고 실패로 알린다.
  if (record.source === "fallback") {
    const { data: prev } = await admin.from("enrollment_consultations").select("prep_brief").eq("id", consultationId).maybeSingle();
    if ((prev?.prep_brief as { source?: string } | null)?.source === "ai") {
      await finishJob(admin, consultationId, jobAt, {
        prep_brief_status: "failed",
        prep_brief_error: "새 브리프를 만들지 못해 이전 브리프를 유지했습니다(이전 생성 시점 자료)",
      });
      return;
    }
  }

  const saved = await finishJob(admin, consultationId, jobAt, {
    prep_brief: record,
    prep_brief_at: record.generatedAt,
    prep_brief_status: null,
    prep_brief_error: null,
  });
  if (saved === "error") {
    // 저장까지 실패하면 failed로 내린다(직전 브리프는 그대로 남는다 — 화면이 재시도를 안내).
    await finishJob(admin, consultationId, jobAt, { prep_brief_status: "failed", prep_brief_error: "브리프 저장에 실패했습니다" });
  }
}

/** 이 작업이 아직 주인일 때만 쓴다(작업 시각 비교) — 아니면 늦게 끝난 옛 작업이라 버린다. */
async function finishJob(
  admin: ReturnType<typeof createAdminClient>,
  consultationId: string,
  jobAt: string,
  patch: Record<string, unknown>,
): Promise<"saved" | "stale" | "error"> {
  const { data, error } = await admin
    .from("enrollment_consultations")
    .update({ ...patch, prep_brief_job_at: null })
    .eq("id", consultationId)
    .eq("prep_brief_job_at", jobAt)
    .select("id");
  if (error) {
    console.error("[prep-brief] 저장 실패", error);
    return "error";
  }
  if (!data || data.length === 0) {
    console.warn("[prep-brief] 더 새 작업이 있어 이 결과는 버림", consultationId);
    return "stale";
  }
  return "saved";
}

/**
 * 학부모 QR 접수 제출 직후 **자동 생성**(원장 지시 2026-07-29) — 상담사가 버튼을 누르러 들어오기 전에
 * 이미 상담지가 준비돼 있게 한다. 세션이 없으므로 admin client + 검증된 tenantId로 수집·저장한다.
 *
 * ⚠️ "페이지 로드로 AI 호출 금지" 규칙과 충돌하지 않는다 — 이건 렌더가 아니라 **제출 이벤트 1회**다
 *    (녹음 업로드 → 전사·분석 웹훅과 같은 모양). 재생성은 여전히 명시 버튼만.
 * 🔴 AI 라이선스가 꺼진 지점은 아무것도 하지 않는다(사실 수집·생성 중 표시·폴백 저장 없음 — "꺼지면 흔적 없이" · 검수 2026-11-11).
 * 실패해도 접수 자체는 이미 저장됐으므로 조용히 로그만 남긴다(학부모 화면에 영향 없음).
 */
export async function generatePrepBriefOnIntake(consultationId: string, tenantId: string): Promise<void> {
  if (!(await isFeatureLicensed(tenantId, "ai_analysis"))) return;
  const admin = createAdminClient();
  let jobAt: string | null = null;
  try {
    // 작업을 먼저 연다 — 사실 수집이 실패해도 'failed'와 안내가 남게(적대 리뷰 2026-11-11 · 합의 6).
    jobAt = await claimPrepBriefJob(admin, consultationId);
    if (!jobAt) return;
    const facts = await collectPrepFacts(consultationId, { client: admin, tenantId });
    if (!facts) {
      await finishJob(admin, consultationId, jobAt, { prep_brief_status: null, prep_brief_error: null });
      return;
    }
    await runPrepBriefGeneration(consultationId, facts, tenantId, jobAt);
  } catch (e) {
    console.error("[prep-brief] QR 자동 생성 실패", e);
    if (jobAt) {
      await finishJob(admin, consultationId, jobAt, { prep_brief_status: "failed", prep_brief_error: "브리프 자료를 읽지 못했습니다" });
    }
  }
}

/**
 * 사전 상담 브리프 생성(명시 트리거 전용) — 페이지 로드로는 절대 안 돈다(AI 캐싱 규칙).
 *
 * **백그라운드 패턴(0153b)** — 회의록 "AI 분석 다시 생성"(regenerateMeetingAnalysis)과 동일:
 * 액션은 ① 게이트 ② 사실 수집(빠름 + 쿠키 세션 = RLS 스코프, 액션 안에서) ③ status='generating'
 * 표시 후 **즉시 반환**하고, 병목(LLM 20~60초)은 `after()`에서 admin client로 마무리한다.
 * 화면은 진행바 + watcher(realtime+폴링)가 완료 시 자동 새로고침. 이전 브리프는 생성 중에도
 * 유지된다(재생성 실패 = 직전 브리프 증발 방지).
 *
 * provider = **Claude Sonnet 5.5**(원장 2026-10-26 결정).
 * Claude가 막히면 ChatGPT 무중단 폴백, 검증(grounding) 탈락 시 결정론 폴백 브리프.
 */
