"use server";
/**
 * AI 비서 서버 액션 — 질문 1건 = 액션 1회(명시적 사용자 트리거라 "페이지 로드 무호출" 원칙과 무충돌).
 * 게이트 = 대시보드 카드 노출과 동일(canManageStaff: master/admin/manager) + dashboard write —
 * 유료 AI 호출 통제(#S5 계열, regenerateDailyBriefing과 동일 기준). 대화 저장은 사용자 세션
 * (own-row RLS, 0117a) — service_role 불사용.
 */
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report-error";
import { appendTurns, parseStoredTurns, type StoredTurn } from "../turns";
import { runAssistantLoop } from "./loop";

const MAX_QUESTION_CHARS = 500;

export type AskAssistantResult =
  | { ok: true; conversationId: string; turns: StoredTurn[] }
  | { ok: false; error: string };

export async function askAssistant(
  conversationId: string | null,
  question: string,
): Promise<AskAssistantResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { ok: false, error: "비서를 사용할 권한이 없습니다" };
  }
  const trimmed = question.trim();
  if (!trimmed) return { ok: false, error: "질문을 입력해 주세요" };
  if (trimmed.length > MAX_QUESTION_CHARS) {
    return { ok: false, error: `질문은 ${MAX_QUESTION_CHARS}자 이내로 입력해 주세요` };
  }

  const supabase = await createClient();
  let existing: { id: string; messages: unknown } | null = null;
  if (conversationId) {
    const { data, error } = await supabase
      .from("assistant_conversations")
      .select("id, messages")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) return { ok: false, error: `대화를 불러오지 못했습니다: ${error.message}` };
    existing = data;
  }
  const history = parseStoredTurns(existing?.messages);

  let answer: string;
  let model: string;
  try {
    const result = await runAssistantLoop({ question: trimmed, history, tenantId: user.tenantId });
    answer = result.answer;
    model = result.model;
  } catch (e) {
    reportError(e, { scope: "assistant.ask", userId: user.id });
    // 루프가 키/한도 오류를 한글화하지 않는 경로도 있으니 사용자향 문구로 감싼다(원문은 로그).
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `답변 생성에 실패했습니다: ${msg}` };
  }

  const turns = appendTurns(history, trimmed, answer, new Date().toISOString());
  if (existing) {
    const { error } = await supabase
      .from("assistant_conversations")
      .update({ messages: turns, model_version: model })
      .eq("id", existing.id);
    if (error) reportError(error, { scope: "assistant.save", conversationId: existing.id });
    return { ok: true, conversationId: existing.id, turns };
  }
  const { data: created, error: insertError } = await supabase
    .from("assistant_conversations")
    .insert({
      tenant_id: user.tenantId,
      user_id: user.id,
      title: trimmed.slice(0, 60),
      messages: turns,
      model_version: model,
    })
    .select("id")
    .single();
  if (insertError || !created) {
    // 저장 실패해도 답은 이미 만들어졌다 — 답변은 보여주되 저장 실패를 로그로(다음 질문은 새 대화).
    reportError(insertError ?? new Error("insert returned no row"), { scope: "assistant.save" });
    return { ok: true, conversationId: "", turns };
  }
  return { ok: true, conversationId: created.id as string, turns };
}
