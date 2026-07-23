"use server";

// AI 멘트 프롬프트 오버라이드 — 원장 콘솔에서 멘트/추세 프롬프트를 런타임 편집·테스트(edutrix aiSettingsActions 이식).
// 저장은 append-only(활성 비활성화 후 새 활성 insert = 버전 이력). 읽기는 로그인, 쓰기는 owner 메뉴 쓰기 게이트.
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { generateJSON } from "@/lib/ai/generate";
import {
  DEFAULT_PROMPTS,
  isPromptInUse,
  MENT_AI_TUNING,
  PROMPT_TYPES,
  PROMPT_TYPE_LABELS,
  REQUIRED_PLACEHOLDER,
  type PromptType,
} from "../prompt-defaults";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  buildReportCommentPrompt,
  buildCommentP1Prompt,
  buildCommentP2Prompt,
  type ReportCommentInput,
} from "../report-comment";
import { buildTrendInput, buildTrendPrompt } from "../trend-comment";
import { fetchScoreHistory, fetchSpecialClassIds } from "./score-history";

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
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
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

/** 프롬프트 저장 — 활성 비활성화 후 새 활성 insert(버전 append). owner 쓰기 권한 + 자리표시자 검증. */
export async function savePrompt(type: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "학원 설정(owner) 변경 권한이 없습니다" };
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "프롬프트가 비어 있습니다" };
  // 자리표시자 없으면 입력(사실/기록)이 프롬프트에 안 실림 → 저장 거부(원장 실수 방지).
  if (!trimmed.includes(REQUIRED_PLACEHOLDER[type])) {
    return { ok: false, error: `프롬프트에 ${REQUIRED_PLACEHOLDER[type]} 자리표시자가 반드시 있어야 합니다` };
  }
  const supabase = await createClient();
  await supabase
    .from("ai_prompt_overrides")
    .update({ is_active: false })
    .eq("tenant_id", user.tenantId)
    .eq("prompt_type", type)
    .eq("is_active", true);
  const { error } = await supabase.from("ai_prompt_overrides").insert({
    tenant_id: user.tenantId,
    prompt_type: type,
    prompt_text: trimmed,
    is_active: true,
    created_by: user.id,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 기본값 복원 — 활성 오버라이드 비활성화(이력은 남김). 이후 기본 프롬프트 사용. */
export async function resetPrompt(type: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "owner"))) return { ok: false, error: "학원 설정(owner) 변경 권한이 없습니다" };
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ai_prompt_overrides")
    .update({ is_active: false })
    .eq("tenant_id", user.tenantId)
    .eq("prompt_type", type)
    .eq("is_active", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type PromptVersion = { id: string; text: string; isActive: boolean; createdAt: string };

/** 버전 이력 — 최근 20건(활성 표시). 롤백은 텍스트 복사 후 저장(=새 버전). */
export async function getPromptHistory(type: string): Promise<{ ok: boolean; versions?: PromptVersion[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
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
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const supabase = await createClient();
  const { data: reports } = await supabase
    .from("lesson_reports")
    .select("id, report_date, progress, student_id")
    .eq("tenant_id", user.tenantId)
    .not("progress", "is", null)
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

/** 저장 없이 미리보기 — 편집 중 텍스트 + 실 보고서 데이터로 생성해 결과만 반환(edutrix testNoticePromptByType). */
export async function testPrompt(
  type: string,
  text: string,
  reportId: string,
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!isPromptType(type)) return { ok: false, error: "알 수 없는 프롬프트 유형" };
  if (!reportId) return { ok: false, error: "테스트할 보고서를 선택하세요" };
  const trimmed = text.trim();
  if (!trimmed.includes(REQUIRED_PLACEHOLDER[type])) {
    return { ok: false, error: `프롬프트에 ${REQUIRED_PLACEHOLDER[type]} 자리표시자가 필요합니다` };
  }
  const supabase = await createClient();
  const { data: r } = await supabase
    .from("lesson_reports")
    .select("student_id, class_id, subject, progress, daily_test, check_test, attitude, homework_score, textbook, homework_today")
    .eq("id", reportId)
    .maybeSingle();
  if (!r) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  const { data: stu } = await supabase.from("students").select("name").eq("id", r.student_id as string).maybeSingle();

  let prompt: string | null;
  let key: "comment" | "trend";
  if (type === "trend") {
    key = "trend";
    // 미리보기도 프로덕션과 같은 표본을 봐야 한다 — 정규/특강 분리(2026-07-23).
    const specialClassIds = await fetchSpecialClassIds(supabase);
    const history = await fetchScoreHistory(
      supabase,
      r.student_id as string,
      (r.subject as string) ?? undefined,
      kstToday(),
      30,
      { classId: (r.class_id as string | null) ?? null, specialClassIds },
    );
    const input = buildTrendInput(history);
    if (!input) return { ok: false, error: "이 학생은 추세 표본이 부족합니다 — 다른 보고서를 선택하세요" };
    prompt = buildTrendPrompt(input, trimmed);
  } else {
    // comment | comment_p1 | comment_p2 — 저장 보고서엔 특이사항이 없으므로 specialNote=""(P2는 태도만).
    key = "comment";
    const input: ReportCommentInput = {
      studentName: (stu?.name as string) ?? "",
      subject: "", // progress에 과목 라벨 포함(예 "수학 …")
      progress: (r.progress as string) ?? "",
      dailyTest: (r.daily_test as string) ?? "",
      checkTest: (r.check_test as string) ?? "",
      attitude: (r.attitude as string) ?? "",
      homework: r.homework_score && r.homework_score !== "—" ? (r.homework_score as string) : "",
      homeworkToday: (r.homework_today as string) ?? "",
      textbook: (r.textbook as string) ?? "",
      specialNote: "",
    };
    prompt =
      type === "comment_p1"
        ? buildCommentP1Prompt(input, trimmed)
        : type === "comment_p2"
          ? buildCommentP2Prompt(input, trimmed)
          : buildReportCommentPrompt(input, trimmed);
    if (!prompt) return { ok: false, error: "이 보고서엔 해당 문단의 입력이 없습니다 — 다른 보고서를 선택하세요" };
  }

  try {
    const { data } = await generateJSON<{ comment?: string; trend?: string }>({
      prompt,
      maxTokens: 700,
      keyName: "default",
      meta: { feature: "ment_prompt_preview" },
      ...MENT_AI_TUNING,
    });
    const out = ((key === "comment" ? data.comment : data.trend) ?? "").trim();
    return { ok: true, output: out || "(빈 응답)" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "생성 실패" };
  }
}
