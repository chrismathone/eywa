"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { collectPrepFacts } from "@/features/enrollment/server/prep-facts";
import { claimPrepBriefJob, runPrepBriefGeneration } from "@/features/enrollment/server/prep-generate";
import { isFeatureLicensed } from "@/lib/license/server";

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
    return { error: "신규 콜&상담 권한이 없습니다" };
  }

  // AI 라이선스가 꺼진 지점은 서버에서도 막는다(화면은 단추를 안 그리지만 액션은 직접 부를 수 있다 — #77 · 검수 2026-11-11).
  if (!(await isFeatureLicensed(user.tenantId, "ai_analysis"))) return { error: "이 지점에서는 쓸 수 없는 기능입니다" };

  // 사실 수집은 액션 안에서(쿠키 세션 = RLS 스코프 유지 — after() 안에선 요청 컨텍스트가 없다).
  // 병렬 count 위주라 실측 ~0.5초, 버튼 반응을 안 막는다. 조회가 실패하면 던진다(거짓 '0명'을 동결하지 않게).
  let facts: Awaited<ReturnType<typeof collectPrepFacts>>;
  try {
    facts = await collectPrepFacts(consultationId);
  } catch (e) {
    console.error("[prep-brief] 사실 수집 실패", e);
    return { error: "브리프 자료를 읽지 못했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  if (!facts) return { error: "상담을 찾을 수 없습니다" };
  const collected = facts;

  // 작업 열기 — 진행 중인 작업(240초 안)이 있으면 새로 시작하지 않는다. 멈춘 작업은 갈아탄다(s2_0068).
  const supabase = await createClient();
  let jobAt: string | null;
  try {
    jobAt = await claimPrepBriefJob(supabase, consultationId);
  } catch (e) {
    console.error("[prep-brief] 상태 표시 실패", e);
    return { error: "생성 시작에 실패했습니다 — 잠시 후 다시 시도해 주세요" };
  }
  if (!jobAt) return { error: "이미 작성 중입니다 — 잠시 후 확인해 주세요" };
  revalidatePath(`/enrollment/${consultationId}`);

  const tenantId = user.tenantId;
  const job = jobAt;

  // LLM 호출은 백그라운드 — 응답 종료 후라 admin client로 쓴다(id 스코프, 접근은 위 RLS 조회로
  // 이미 확인). 회의록 재분석과 동일 구조. 끝나면 이 작업일 때만 결과·상태를 쓴다(늦은 옛 작업은 버린다).
  after(() => runPrepBriefGeneration(consultationId, collected, tenantId, job));

  return { ok: true };
}
