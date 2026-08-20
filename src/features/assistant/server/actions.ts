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
import { revalidatePath } from "next/cache";
import { reportError } from "@/lib/observability/report-error";
import { appendTurns, parseStoredTurns, type StoredTurn } from "../turns";
import type { AssistantLink } from "../links";
import { runAssistantLoop } from "./loop";

const MAX_QUESTION_CHARS = 500;

export type AskAssistantResult =
  | { ok: true; conversationId: string; turns: StoredTurn[]; omittedLinks: number }
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
  let links: AssistantLink[] = [];
  let omittedLinks = 0;
  try {
    const result = await runAssistantLoop({ question: trimmed, history, tenantId: user.tenantId });
    answer = result.answer;
    model = result.model;
    links = result.links;
    omittedLinks = result.omittedLinks;
  } catch (e) {
    reportError(e, { scope: "assistant.ask", userId: user.id });
    // UI에 raw 영문 에러/JSON 원문 노출 금지(CLAUDE.md) — 우리가 한글화한 메시지("AI 키 오류…" 등)만
    // 그대로 통과시키고, provider SDK 원문(400 {"type":"error"…} 등)은 일반 안내로 대체(원문은 위 로그).
    const raw = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: /[가-힣]/.test(raw)
        ? `답변 생성에 실패했습니다: ${raw}`
        : "답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  const turns = appendTurns(history, trimmed, answer, new Date().toISOString(), undefined, links);
  if (existing) {
    const { error } = await supabase
      .from("assistant_conversations")
      .update({ messages: turns, model_version: model })
      .eq("id", existing.id);
    if (error) reportError(error, { scope: "assistant.save", conversationId: existing.id });
    return { ok: true, conversationId: existing.id, turns, omittedLinks };
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
    return { ok: true, conversationId: "", turns, omittedLinks };
  }
  return { ok: true, conversationId: created.id as string, turns, omittedLinks };
}

/**
 * **대화 초기화** — 원장 지시(2026-08-20): *"이전대화가 계속 남아있으니까. '대화 초기화' 버튼도"*.
 *
 * 종전 '새 대화' 버튼은 **클라 state만** 비웠다 — 새로고침하면 dashboard/page가 마지막 대화를 다시
 * 불러와 지난 대화가 그대로 돌아왔다. 그래서 서버 상태를 실제로 지운다.
 *
 * 🔴 **자기 대화 전부**를 지운다(마지막 1건이 아니라) — 패널이 여는 것은 `updated_at` 최신 1건이라
 *    한 건만 지우면 그 전 대화가 도로 올라온다("초기화했는데 또 남아 있다"의 재발).
 * 🔴 `user_id`·`tenant_id`를 **명시 조건**으로 함께 건다 — RLS(own-row)가 이미 막지만, 게이트가
 *    하나뿐이면 그 하나가 바뀌는 날 조용히 넓어진다(#77). 삭제는 되돌릴 수 없어 이중으로 좁힌다.
 * 마이그레이션 0: 표에 보관 플래그가 없어 **삭제가 가장 단순한 초기화**다(대화는 재조회 가능한
 * 파생물이고, 툴 결과 스냅샷도 저장하지 않는다 — 0117a 주석).
 */
export async function resetAssistantConversation(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { ok: false, error: "비서를 사용할 권한이 없습니다" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("assistant_conversations")
    .delete()
    .eq("user_id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) {
    reportError(error, { scope: "assistant.reset", userId: user.id });
    return { ok: false, error: "대화를 초기화하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  // 대시보드가 서버에서 마지막 대화를 실어 오므로 라우터 캐시까지 비운다 — 안 그러면 클라 내비로
  // 되돌아왔을 때 지운 대화가 잠깐 다시 보인다("초기화했는데 또 있다"의 재발).
  revalidatePath("/dashboard");
  return { ok: true };
}
