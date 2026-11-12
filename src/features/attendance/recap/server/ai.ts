import "server-only";
/**
 * 어제 출결 요약의 **AI 정리** 생성·저장 (원장 2026-08-19 승인 · 2026-11-12 Claude·ChatGPT 정책으로 변경).
 *
 * 🔴 페이지 로드는 이 파일을 절대 부르지 않는다 — 명시 버튼(server action)만(CLAUDE.md AI 정책).
 *    마지막 결과는 표에 남아 다시 누르기 전까지 그대로 표시된다.
 * 🔴 provider는 **Claude 우선**(2026-10-26 원장 결정). 키가 없으면 generateJSON이 무중단으로
 *    다른 provider로 폴백한다 — 여기서 키 유무를 따로 검사하지 않는다.
 * 🔑 숫자·명단의 진실은 결정론 다이제스트다. LLM 출력은 `validateRecapBrief` 통과분만 저장하고,
 *    탈락하면 `error`에 한글 사유를 남긴다(화면은 결정론 표를 그대로 그리므로 손실이 없다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import { buildRecapPrompt, validateRecapBrief, type RecapBrief } from "../prompt";
import type { RangeRecap } from "../range";

/** 응답은 짧다(헤드라인 + 항목 5개) — 상한일 뿐이라 크게 잡아도 실사용 토큰만 과금된다. */
const MAX_TOKENS = 4000;

type LabelOf = (subjectKey: string) => string;

/**
 * 생성 → 저장. **호출부(server action)가 이미 `analyzing`으로 선점한 뒤** `after()`에서 부른다.
 * 여기서는 세션(쿠키)에 접근하지 않는다 — 응답 후에 도는 코드라 admin 클라이언트 + 명시 tenantId만 쓴다.
 */
export async function runRecapGeneration(
  tenantId: string,
  recap: RangeRecap,
  subjectLabel: LabelOf,
): Promise<void> {
  const admin = createAdminClient();
  const finish = async (patch: Record<string, unknown>) => {
    const { error } = await admin
      .from("attendance_day_recaps")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("from_date", recap.from)
      .eq("recap_date", recap.to);
    // 저장 실패는 화면에 '정리 중'으로 고착되므로 반드시 로그에 남긴다(#89: 조용한 실패 금지).
    if (error) reportError(error, { scope: "attendance.recap.save", date: recap.to });
  };

  try {
    const { data, model } = await generateJSON<unknown>({
      prompt: buildRecapPrompt(recap, subjectLabel),
      maxTokens: MAX_TOKENS,
      provider: "anthropic", // 2026-10-26 원장 결정 — Sonnet 5.5(기본 등급)
      meta: { tenantId, feature: "attendance_recap" },
    });
    const checked = validateRecapBrief(data, recap, subjectLabel);
    if (!checked.ok) {
      // 환각 차단은 정상 동작이다 — 실패로 남기되 원인을 사람 말로 적는다.
      reportWarning(`출결 요약 AI 후검증 탈락: ${checked.reason}`, {
        scope: "attendance.recap.validate",
        date: recap.to,
      });
      await finish({
        status: "failed",
        summary: null,
        error: `AI 정리가 사실 검증을 통과하지 못했습니다 (${checked.reason}). 아래 집계는 그대로 사용하세요.`,
        model_version: model,
      });
      return;
    }
    await finish({
      status: "completed",
      summary: checked.value satisfies RecapBrief,
      error: null,
      model_version: model,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    reportError(e, { scope: "attendance.recap.generate", date: recap.to });
    await finish({
      status: "failed",
      summary: null,
      // UI에 raw 원문을 흘리지 않는다 — 원문은 로그로만.
      error: "AI 정리를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  }
}
