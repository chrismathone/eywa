"use server";

// AI 멘트 프롬프트 오버라이드 — 원장 콘솔에서 멘트/추세 프롬프트를 런타임 편집·테스트(edutrix aiSettingsActions 이식).
// 저장은 append-only(활성 비활성화 후 새 활성 insert = 버전 이력). 조회·변경은 AI 멘트 메뉴 권한을 따른다.
import { requireAiMentAccess } from "@/features/report-admin/server/ai-ment-access";
import { logAction } from "@/features/audit/server/log";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_PROMPTS,
  isPromptInUse,
  PROMPT_TYPES,
  PROMPT_TYPE_LABELS,
  REQUIRED_PLACEHOLDER,
  type PromptType,
} from "../prompt-defaults";
import { getTenantSettings } from "@/features/owner/server/queries";
import { runMentPreview } from "./ment-preview";
import { explainDbError } from "@/lib/supabase/db-error";

export type PromptRow = {
  type: PromptType;
  label: string;
  text: string; // 활성 오버라이드 또는 기본값
  isCustom: boolean; // 오버라이드 존재
  updatedAt: string | null;
  /**
   * 지금 이 학원에서 **실제로 쓰이는 프롬프트인지**. 모드 A면 comment만, B면 P1·P2만 쓰인다.
   * false면 편집·저장은 되지만 생성에 전혀 안 쓰인다 — 화면이 그걸 밝혀야 원장이 헛수고를 안 한다.
   */
  inUse: boolean;
};

/**
 * 지금 이 학원에서 쓰이는 공지 모드 집합 — **학원 기본 + 강사 개인 지정의 합집합**.
 * (강사가 개인 모드를 지정하면 학원 기본을 덮으므로, 둘 중 하나라도 B면 P1·P2가 실제로 쓰인다.)
 * 조회 실패는 학원 기본만으로 폴백 — 이 값 때문에 편집 화면이 막히면 안 된다.
 */
async function usedNoticeModes(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<Set<string>> {
  const settings = await getTenantSettings();
  const modes = new Set<string>([settings.report.noticeMode ?? "A"]);
  const { data } = await supabase
    .from("users")
    .select("report_notice_mode")
    .eq("tenant_id", tenantId)
    .not("report_notice_mode", "is", null);
  for (const u of data ?? []) {
    const m = u.report_notice_mode as string | null;
    if (m === "A" || m === "B") modes.add(m);
  }
  return modes;
}

function isPromptType(t: string): t is PromptType {
  return (PROMPT_TYPES as readonly string[]).includes(t);
}

/** 현재 테넌트 프롬프트 상태 — 타입별 활성 오버라이드(있으면) 또는 기본값. */
export async function getActivePrompts(): Promise<{ ok: boolean; prompts?: PromptRow[]; error?: string }> {
  const gate = await requireAiMentAccess();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  const supabase = await createClient();
  // 오버라이드 조회와 사용 모드 판정은 서로 독립 — 직렬 await 금지(B4).
  const [{ data }, modes] = await Promise.all([
    supabase
      .from("ai_prompt_overrides")
      .select("prompt_type, prompt_text, updated_at")
      .eq("tenant_id", user.tenantId)
      .eq("is_active", true),
    usedNoticeModes(supabase, user.tenantId),
  ]);
  const active = new Map((data ?? []).map((r) => [r.prompt_type as string, r]));
  const prompts: PromptRow[] = PROMPT_TYPES.map((type) => {
    const row = active.get(type);
    return {
      type,
      label: PROMPT_TYPE_LABELS[type],
      text: (row?.prompt_text as string) || DEFAULT_PROMPTS[type],
      isCustom: !!row,
      updatedAt: (row?.updated_at as string) ?? null,
      inUse: isPromptInUse(type, modes),
    };
  });
  return { ok: true, prompts };
}

/**
 * 프롬프트 저장 — 활성 비활성화 후 새 활성 insert(버전 append). AI 멘트 변경 권한 + 자리표시자 검증.
 * 🔴 **기본값과 같은 글은 사용자 지정으로 저장하지 않는다**(원장 2026-10-16 후속) — 저장하면 그 시점의 기본값이 이 학원에 굳어,
 *    뒤에 기본 프롬프트를 고쳐도(예: 추세 '정도로만') 이 학원엔 닿지 않는다. 대신 사용자 지정을 끄고 기본값을 따르게 한다.
 */
export async function savePrompt(type: string, text: string): Promise<{ ok: boolean; usedDefault?: boolean; error?: string }> {
  const gate = await requireAiMentAccess(true);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "프롬프트가 비어 있습니다" };
  // 자리표시자 없으면 입력(사실/기록)이 프롬프트에 안 실림 → 저장 거부(원장 실수 방지).
  if (!trimmed.includes(REQUIRED_PLACEHOLDER[type])) {
    return { ok: false, error: `프롬프트에 ${REQUIRED_PLACEHOLDER[type]} 자리표시자가 반드시 있어야 합니다` };
  }
  const supabase = await createClient();
  if (isSameAsDefault(type, trimmed)) return switchToDefaultPrompt(supabase, gate.user.tenantId, type);
  // 버전 교체를 한 트랜잭션으로 실행한다. 저장 실패나 권한 회수 중에도 기존 활성 버전이 사라지지 않는다.
  const { error } = await supabase.rpc("save_ai_prompt_setting", { p_type: type, p_text: trimmed });
  if (error) return { ok: false, error: explainDbError(error, { scope: "onescreen.prompt-actions.savePrompt", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // 🔴 프롬프트는 **AI 산출물의 내용을 바꾸는 설정**이라 누가 언제 바꿨는지가 남아야 한다
  //    (본문은 남기지 않는다 — 이력은 ai_prompt_overrides 버전 목록이 들고 있다).
  await logAction({
    action: "ai_prompt_save",
    targetType: "ai_prompt",
    targetLabel: PROMPT_TYPE_LABELS[type] ?? type,
    metadata: { type, length: trimmed.length },
  });
  return { ok: true };
}

/** 줄바꿈(CRLF)·앞뒤 공백만 다른 글은 같은 글이다 — 화면 textarea가 줄바꿈을 바꿔 보낼 수 있다. */
function isSameAsDefault(type: PromptType, text: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return norm(text) === norm(DEFAULT_PROMPTS[type]);
}

/** 기본값과 같은 저장 = 사용자 지정이 켜져 있으면 끈다(복원과 같은 RPC · 감사로그), 없으면 아무것도 쓰지 않는다. */
async function switchToDefaultPrompt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  type: PromptType,
): Promise<{ ok: boolean; usedDefault?: boolean; error?: string }> {
  const { data: active, error: readError } = await supabase
    .from("ai_prompt_overrides")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("prompt_type", type)
    .eq("is_active", true)
    .limit(1);
  if (readError) return { ok: false, error: "지금 저장된 프롬프트를 확인하지 못했습니다" };
  if (!active?.length) return { ok: true, usedDefault: true };
  const { error } = await supabase.rpc("save_ai_prompt_setting", { p_type: type, p_text: null });
  if (error) return { ok: false, error: explainDbError(error, { scope: "onescreen.prompt-actions.switchToDefaultPrompt", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  await logAction({
    action: "ai_prompt_reset",
    targetType: "ai_prompt",
    targetLabel: PROMPT_TYPE_LABELS[type] ?? type,
    metadata: { type, reason: "same_as_default" },
  });
  return { ok: true, usedDefault: true };
}

/** 기본값 복원 — 활성 오버라이드 비활성화(이력은 남김). 이후 기본 프롬프트 사용. */
export async function resetPrompt(type: string): Promise<{ ok: boolean; error?: string }> {
  const gate = await requireAiMentAccess(true);
  if ("error" in gate) return { ok: false, error: gate.error };
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_ai_prompt_setting", { p_type: type, p_text: null });
  if (error) return { ok: false, error: explainDbError(error, { scope: "onescreen.prompt-actions.resetPrompt", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // ⚠️ 복원은 행을 **비활성화만** 하므로 DB엔 "누가 껐는지"가 남지 않는다 — 그 사실이 여기에만 남는다.
  await logAction({
    action: "ai_prompt_reset",
    targetType: "ai_prompt",
    targetLabel: PROMPT_TYPE_LABELS[type] ?? type,
    metadata: { type },
  });
  return { ok: true };
}

export type PromptVersion = { id: string; text: string; isActive: boolean; createdAt: string };

/** 버전 이력 — 최근 20건(활성 표시). 롤백은 텍스트 복사 후 저장(=새 버전). */
export async function getPromptHistory(type: string): Promise<{ ok: boolean; versions?: PromptVersion[]; error?: string }> {
  const gate = await requireAiMentAccess();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("ai_prompt_overrides")
    .select("id, prompt_text, is_active, created_at")
    .eq("tenant_id", user.tenantId)
    .eq("prompt_type", type)
    .order("created_at", { ascending: false })
    .limit(20);
  const versions = (data ?? []).map((r) => ({
    id: r.id as string,
    text: r.prompt_text as string,
    isActive: !!r.is_active,
    createdAt: r.created_at as string,
  }));
  return { ok: true, versions };
}

export type TestReportOption = { id: string; label: string };

/** 테스트용 최근 보고서 목록(원스크린 저장분) — 이름·날짜·진도 앞부분 라벨. */
export async function getRecentReportsForTest(): Promise<{ ok: boolean; reports?: TestReportOption[]; error?: string }> {
  const gate = await requireAiMentAccess();
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("lesson_reports")
    .select("id, report_date, progress, student_id")
    .eq("tenant_id", user.tenantId)
    .not("progress", "is", null)
    // 영어 행은 원스크린에서 템플릿 모드라 이 프롬프트를 쓰지 않는다 — 시험 목록에서 뺀다(옛 보고서는 과목 없음 = 수학).
    .or("subject.is.null,subject.neq.english")
    .order("report_date", { ascending: false })
    .limit(30);
  const rows = reports ?? [];
  const ids = [...new Set(rows.map((r) => r.student_id as string))];
  const { data: students } = await supabase.from("students").select("id, name").in("id", ids);
  const nameById = new Map((students ?? []).map((s) => [s.id as string, s.name as string]));
  const options: TestReportOption[] = rows.map((r) => {
    const name = nameById.get(r.student_id as string) ?? "학생";
    const date = (r.report_date as string)?.slice(5) ?? "";
    const prog = ((r.progress as string) ?? "").slice(0, 18);
    return { id: r.id as string, label: `${name} · ${date} · ${prog}` };
  });
  return { ok: true, reports: options };
}

/**
 * 저장 없이 미리보기 — 편집 중 텍스트 + 실 보고서로 생성해 결과만 반환.
 * 🔴 운영 자동작성과 **같은 재료·조립·모델(fast)·생성 뒤 검사**(ment-preview.ts · 원장 2026-10-16 후속) — 예전엔 특이사항 없이·Sonnet으로·
 *    검사 없이 돌아 여기서 본 글과 실제 글이 달랐다.
 */
export async function testPrompt(
  type: string,
  text: string,
  reportId: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const gate = await requireAiMentAccess(true);
  if ("error" in gate) return { ok: false, error: gate.error };
  const { user } = gate;
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  if (!reportId) return { ok: false, error: "테스트할 보고서를 선택하세요" };
  const trimmed = text.trim();
  if (!trimmed.includes(REQUIRED_PLACEHOLDER[type])) {
    return { ok: false, error: `프롬프트에 ${REQUIRED_PLACEHOLDER[type]} 자리표시자가 필요합니다` };
  }
  try {
    return await runMentPreview(await createClient(), user.tenantId, type, trimmed, reportId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "생성 실패" };
  }
}
