"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { collectPrepFacts } from "@/features/enrollment/server/prep-facts";
import { runPrepBriefGeneration } from "@/features/enrollment/server/prep-generate";

export type PrepBriefState = { error?: string; ok?: boolean } | undefined;

export async function generatePrepBrief(
  _prev: PrepBriefState,
  formData: FormData,
): Promise<PrepBriefState> {
  const consultationId = String(formData.get("consultationId") ?? "");
  if (!consultationId) return { error: "상담 ID가 누락되었습니다" };

  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) {
    return { error: "콜&상담 권한이 없습니다" };
  }

  // 사실 수집은 액션 안에서(쿠키 세션 = RLS 스코프 유지 — after() 안에선 요청 컨텍스트가 없다).
  // 병렬 count 위주라 실측 ~0.5초, 버튼 반응을 안 막는다.
  const facts = await collectPrepFacts(consultationId);
  if (!facts) return { error: "상담을 찾을 수 없습니다" };

  const supabase = await createClient();
  const { error: markError } = await supabase
    .from("enrollment_consultations")
    .update({ prep_brief_status: "generating", prep_brief_error: null })
    .eq("id", consultationId);
  if (markError) {
    console.error("[prep-brief] 상태 표시 실패", markError);
    return { error: "생성 시작에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  revalidatePath(`/enrollment/${consultationId}`);

  const tenantId = user.tenantId;

  // LLM 호출은 백그라운드 — 응답 종료 후라 admin client로 쓴다(id 스코프, 접근은 위 RLS 조회로
  // 이미 확인). 회의록 재분석과 동일 구조. 실패해도 진행바가 영원히 돌지 않게 반드시 status를 내린다.
  after(() => runPrepBriefGeneration(consultationId, facts, tenantId));

  return { ok: true };
}
