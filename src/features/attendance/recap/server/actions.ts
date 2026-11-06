"use server";
/**
 * 어제 출결 요약 — 'AI로 정리' (유일한 사용자 트리거 AI 호출).
 *
 * 흐름은 일일 브리핑 '다시 생성'과 같다: **원자 claim**(analyzing 선점) → `after()` 백그라운드 생성 →
 * 클라 폴링(router.refresh)이 완성본을 가져온다. 요약 자체(결정론 집계)는 이 액션과 무관하게 늘 보인다.
 *
 * 🔴 집계는 **요청 안에서** 끝낸다 — `after()`는 응답 뒤에 돌아 세션(쿠키)에 기대면 안 된다. 그래서
 *    무거운 LLM 호출만 뒤로 넘기고, 재료(결정론 recap·과목 라벨)는 여기서 만들어 넘긴다.
 */
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { reportError } from "@/lib/observability/report-error";
import { kstToday } from "@/lib/date-kst";
import { getRangeRecap } from "./queries";
import { recapRangeDates } from "../range";
import { runRecapGeneration } from "./ai";

/** 생성이 이 시간을 넘겨 analyzing으로 굳어 있으면 다시 누를 수 있게 한다(고착 우회). */
const STUCK_MS = 5 * 60 * 1000;

export async function generateRecapSummary(
  from: string,
  to: string,
): Promise<{ ok?: boolean; error?: string }> {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(from) || !ymd.test(to) || from > to) return { error: "날짜 형식이 올바르지 않습니다" };
  if (to > kstToday()) return { error: "미래 날짜는 요약할 수 없습니다" };

  // 요청자(requested_by)는 화면 주인 — 강사뷰면 검증된 대상(읽기 강사뷰는 아래 수준 캡이 막는다).
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  // 요약 탭과 **같은 게이트**(사무실 full) — 화면에서만 감추면 게이트가 아니다(#77).
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") {
    return { error: "출결 요약을 정리할 권한이 없습니다" };
  }

  const recap = await getRangeRecap(recapRangeDates(from, to));
  if (!recap) return { error: "출결 요약을 불러오지 못했습니다" };
  if (recap.totals.slots === 0) return { error: "그 기간엔 수업이 없어 정리할 내용이 없습니다" };

  const settings = await getTenantSettings();
  const subjectLabel = buildSubjectMaps(settings.operations.subjects).labelOf;

  const admin = createAdminClient();
  const now = new Date();
  const { data: existing, error: readError } = await admin
    .from("attendance_day_recaps")
    .select("id, status, updated_at")
    .eq("tenant_id", user.tenantId)
    .eq("from_date", from)
    .eq("recap_date", to)
    .maybeSingle();
  if (readError) {
    // 표가 아직 없을 수도 있다(마이그레이션 적용 전) — 원문은 로그로만, 화면엔 한글 안내.
    reportError(readError, { scope: "attendance.recap.claim.read", date: to });
    return { error: "요약 저장소를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }

  if (existing) {
    const stuck =
      existing.status === "analyzing" &&
      now.getTime() - new Date(existing.updated_at as string).getTime() > STUCK_MS;
    let claim = admin
      .from("attendance_day_recaps")
      .update({ status: "analyzing", error: null, updated_at: now.toISOString() })
      .eq("id", existing.id);
    if (!stuck) claim = claim.neq("status", "analyzing");
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) {
      reportError(claimError, { scope: "attendance.recap.claim.update", date: to });
      return { error: "정리를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
    if (!claimed || claimed.length === 0) {
      return { error: "이미 정리가 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." };
    }
  } else {
    const { error: insertError } = await admin.from("attendance_day_recaps").insert({
      tenant_id: user.tenantId,
      from_date: from,
      recap_date: to,
      status: "analyzing",
      requested_by: user.id,
    });
    if (insertError) {
      // 23505 = 동시 클릭 경합(상대가 먼저 행을 만듦) — 진행 중으로 안내.
      if ((insertError as { code?: string }).code === "23505") {
        return { error: "이미 정리가 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." };
      }
      reportError(insertError, { scope: "attendance.recap.claim.insert", date: to });
      return { error: "정리를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }

  const tenantId = user.tenantId;
  after(async () => {
    await runRecapGeneration(tenantId, recap, subjectLabel);
    revalidatePath("/attendance/live");
  });
  return { ok: true };
}
