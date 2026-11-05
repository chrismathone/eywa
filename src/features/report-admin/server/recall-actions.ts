"use server";

/**
 * 수업보고서 **회수**(ClassNote 학부모 게시글 삭제) 요청 — 관리자 전체 / 강사 본인 보고서.
 *
 * 회수는 여기서 **끝나지 않는다**: 이 액션은 행을 `recall_requested`로 표시하고 링크를 즉시 죽일 뿐이고,
 * ClassNote 게시글의 실제 삭제는 **연동 PC 워커**(classnote-recall-core.mjs)가 로그인 세션으로 수행한다
 * (Vercel에선 ClassNote 세션을 못 만든다 — 발송·반 공지 회수와 같은 구조).
 *
 * ## 링크는 즉시 죽인다 (워커를 기다리지 않는 이유)
 * 워커 폴 간격만큼 학부모가 볼 수 있는 창이 남으면 안 되므로 `revoked_at`을 이 자리에서 세운다.
 * 게시글의 스크린샷 이미지는 삭제 전까지 남지만, 최소한 링크로 열리는 최신 내용은 그 즉시 차단된다.
 *
 * ## 게이트 (#77 — 한 레코드의 모든 표면이 같은 게이트를 지난다)
 * 관리자(lesson_reports 쓰기 권한)는 테넌트 전체, 그 외는 **그 보고서 날짜 기준 담당 학생**만.
 * UI에서 버튼을 감추는 것은 게이트가 아니다 — id를 직접 넘겨도 여기서 막힌다.
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { teacherOwnsStudent } from "@/features/onescreen/server/scope";
import { ownsMakeupReport } from "@/features/onescreen/makeup-owner";
import { RECALL_FAILED, RECALL_REQUESTED, partitionRecallTargets } from "../report-recall";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";

/** 한 번에 처리할 상한 — 실수로 전체 선택해 대량 삭제가 나가는 것을 구조적으로 막는다. */
const MAX_PER_CALL = 100;

export type RecallResult = {
  ok: boolean;
  /** 회수 요청이 실제로 걸린 건수. */
  recalled?: number;
  /** 회수할 수 없어 제외된 건수(미발송·처리 중·이미 회수 등). */
  skipped?: number;
  /** 담당이 아니라 제외된 건수(강사 경로). */
  forbidden?: number;
  error?: string;
};

/**
 * 공유 토큰으로 회수(강사 카드 경로) — 원스크린 카드는 보고서 id를 모르고 공유 토큰만 안다
 * (revokeShareLink·reissueShareLink와 같은 키). **게이트는 아래 본체 하나뿐** — 진입점만 둘이다.
 */
export async function requestReportRecallByShareToken(shareToken: string): Promise<RecallResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — canWriteTenant 캡만으론 부족하다: 겸직이 같은 학생을 직접 담당하면
  // 아래 소유 판정(teacherOwnsStudent·ownsMakeupReport)이 본인 축으로 열려 열람 중 회수가 뚫린다(#77).
  {
    const roError = await readonlyTeacherViewError();
    if (roError) return { ok: false, error: roError };
  }
  if (!shareToken) return { ok: false, error: "링크 정보가 없습니다" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_reports")
    .select("id")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (!data) return { ok: false, error: "보고서를 찾을 수 없습니다" };
  return requestReportRecall([data.id as string]);
}

/**
 * 회수 = **삭제만**. 다시 보내는 것은 별도 버튼이 아니라 **'ClassNote 발송'** 이 맡는다
 * (원장 2026-08-06: *"회수하고 클래스노트 발송 버튼 누르면 그게 재발송 아닌가"*).
 * 발송 시 `saveAndQueueClassnote`가 `recalled` 행을 새 토큰으로 되돌려 평범한 발송으로 처리한다.
 */
export async function requestReportRecall(ids: string[]): Promise<RecallResult> {
  // '다른 강사 뷰'면 담당·작성 소유 판정과 회수 명의(revoked_by)가 대상 강사 X다 — 실제 계정 A로 보면 X의 학생·X가 쓴 보강이
  // '담당이 아님'으로 막힌다. 감사로그 행위자는 logAction이 실제 계정으로 남긴다.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };
  // '다른 강사 뷰'(열람 전용) 차단 — 위 requestReportRecallByShareToken과 같은 이유(겸직 본인 축 우회).
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if (!ids?.length) return { ok: false, error: "대상이 없습니다" };
  const capped = ids.slice(0, MAX_PER_CALL);
  const supabase = await createClient();

  // ⚠️ 임베드는 FK 이름을 명시한다(#94 — lesson_reports→students FK가 늘면 맨몸 임베드는 전 쿼리가 죽는다).
  const { data: rows, error: readError } = await supabase
    .from("lesson_reports")
    .select(
      "id, student_id, report_date, classnote_status, share_token, makeup, class_id, created_by, teacher_name, students!lesson_reports_student_id_fkey(name)",
    )
    .in("id", capped);
  if (readError) return { ok: false, error: humanizeDbError(readError.message, "보고서 조회") };
  if (!rows?.length) return { ok: false, error: "보고서를 찾을 수 없습니다" };

  // 권한 — 관리자는 전체, 그 외는 담당 학생만(보고서 **날짜 기준**: 임시 위임 0173a는 기간이 있어
  // 오늘로 판정하면 어제 위임분을 못 만진다. revokeShareLink와 같은 규약).
  const isAdmin = await canWriteTenant(user.systemRole, "lesson_reports");
  let allowed = rows;
  let forbidden = 0;
  if (!isAdmin) {
    const owned = await Promise.all(
      rows.map(async (r) => {
        // 🔴 **보강(수업외) 보고서는 담당 판정으로 막으면 안 된다** — 보강 학생은 정의상 내 반 수강생이
        //    아닌 경우가 흔해(`buildMakeupStudent`가 학원 전체를 허용) `teacherOwnsStudent`가 false가 된다.
        //    실측(2026-08-18): 발송된 순수 보강 168건 중 **정확히 절반(84건)** 이 이 게이트에서 거부됐다 —
        //    자기가 쓴 보고서를 자기가 회수하지 못하는 상태였다(보강 빼기·카드 회수 버튼 모두).
        //    보강은 **작성 소유**가 담당 판정을 대신한다(원스크린 로스터가 이 축으로 행을 되살린다).
        if (r.makeup === true && !r.class_id) {
          return ownsMakeupReport(
            { createdBy: r.created_by as string | null, teacherName: r.teacher_name as string | null },
            user.id,
            user.displayName ?? "",
          );
        }
        return teacherOwnsStudent(
          supabase,
          user.id,
          r.student_id as string,
          r.report_date as string,
        ).catch(() => false);
      }),
    );
    allowed = rows.filter((_, i) => owned[i]);
    forbidden = rows.length - allowed.length;
    if (!allowed.length)
      return {
        ok: false,
        forbidden,
        error: "담당 학생의 보고서 또는 내가 쓴 보강 보고서만 회수할 수 있습니다",
      };
  }

  const { targets, blocked } = partitionRecallTargets(
    allowed.map((r) => ({
      id: r.id as string,
      classnoteStatus: (r.classnote_status as string | null) ?? null,
      shareToken: (r.share_token as string | null) ?? null,
    })),
  );
  const skipped = blocked.length + (capped.length - rows.length);
  if (!targets.length) {
    // 가장 흔한 단건 실패는 사유를 그대로 돌려준다(왜 안 되는지 화면에서 읽히게).
    return { ok: false, skipped, forbidden, error: blocked[0]?.reason ?? "회수할 수 있는 보고서가 없습니다" };
  }

  // 원자 가드 — 동시 더블클릭·다른 관리자 경합에도 한 번만 걸린다(이미 요청된 행은 상태가 달라 안 잡힘).
  const { data: updated, error } = await supabase
    .from("lesson_reports")
    .update({
      classnote_status: RECALL_REQUESTED,
      classnote_error: null,
      classnote_processing_at: null,
      // 링크 즉시 차단 — 워커 폴을 기다리는 동안 학부모가 여는 창을 없앤다(위 주석).
      revoked_at: new Date().toISOString(),
      revoked_by: user.id,
    })
    .in("id", targets)
    .in("classnote_status", ["success", RECALL_FAILED])
    .select("id");
  if (error) return { ok: false, error: humanizeDbError(error.message, "회수 요청") };

  const names = allowed
    .filter((r) => (updated ?? []).some((u) => u.id === r.id))
    .map((r) => (r.students as { name?: string } | null)?.name)
    .filter(Boolean);
  await logAction({
    action: "classnote_report_recall",
    targetType: "lesson_report",
    targetLabel: names.slice(0, 5).join(", ") || null,
    metadata: {
      reportCount: (updated ?? []).length,
      studentNames: names.slice(0, 20),
      byAdmin: isAdmin,
    },
  });

  revalidatePath("/lesson-reports");
  revalidatePath("/onescreen");
  return { ok: true, recalled: (updated ?? []).length, skipped, forbidden };
}
