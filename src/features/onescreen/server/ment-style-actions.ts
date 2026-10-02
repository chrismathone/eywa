"use server";

// 강사 말투 프로파일(0262a) — 학원설정 > AI 멘트 카드의 서버 액션(목록·지금 갱신).
// 읽기·쓰기 게이트 = 프롬프트 편집(prompt-actions.ts)과 같은 **AI 멘트 메뉴 권한**. 주간 갱신은 cron 라우트가 같은 빌드 함수를 부른다.
import { requireAiMentAccess } from "@/features/report-admin/server/ai-ment-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";
import { logAction } from "@/features/audit/server/log";
import { listTeacherMentStyles, type MentStyleListRow } from "./ment-style-db";
import { rebuildTenantMentStyles, summarizeRebuild, type RebuildSummary } from "./ment-style-build";

export type MentStyleView = { rows: MentStyleListRow[]; tableMissing: boolean; error?: string };

/** [지금 갱신]의 시간 예산 — 보고서 관리 세그먼트의 상한(300s) 안에서 응답까지 남기고. */
const MANUAL_BUDGET_MS = 200_000;

/** 카드 목록 — 표가 없으면 tableMissing(화면이 "아직 준비 중"이라 말한다). */
export async function getMentStyleRows(): Promise<MentStyleView> {
  const gate = await requireAiMentAccess();
  if ("error" in gate) return { rows: [], tableMissing: false, error: gate.error };
  const { user } = gate;
  return listTeacherMentStyles(createAdminClient(), user.tenantId);
}

/**
 * [지금 갱신] — cron을 기다리지 않고 이 학원 강사 전원을 다시 접는다(지문이 같은 강사는 AI 0회).
 * 🔴 AI 산출물의 내용을 바꾸는 일이라 감사로그 필수(누가 언제 · 강사별 결과).
 * 🔴 화면엔 한글 요약만 — DB·AI 원문 오류는 로그로(raw 코드 노출 금지 규약). 강사별 사유는 감사로그 metadata에 남는다.
 */
export async function rebuildMentStylesNow(): Promise<{ ok: boolean; error?: string; summary?: RebuildSummary; view?: MentStyleView }> {
  const gate = await requireAiMentAccess(true);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  const admin = createAdminClient();
  let summary: RebuildSummary;
  try {
    summary = await rebuildTenantMentStyles(admin, user.tenantId, { builtBy: user.id, budgetMs: MANUAL_BUDGET_MS });
  } catch (e) {
    reportWarning("강사 말투 갱신 실패", { scope: "rebuildMentStylesNow", message: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: "갱신에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  if (summary.tableMissing) return { ok: false, error: "강사 말투 표(0262a)가 아직 적용되지 않았습니다" };
  const counts = summarizeRebuild(summary);
  await logAction({
    action: "ment_style_rebuild",
    targetType: "ment_style",
    targetLabel: "강사 말투 프로파일",
    metadata: {
      trigger: "manual",
      ...counts,
      teachers: summary.teachers.map((t) => ({ name: t.teacherName, outcome: t.outcome, samples: t.samples, reason: t.reason ?? null })),
    },
  });
  const view = await listTeacherMentStyles(admin, user.tenantId);
  return { ok: true, summary, view };
}
