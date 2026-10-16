"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { logAction } from "@/features/audit/server/log";
import { loadPairRoundMaterials, pairRounds } from "@/features/video-submit/server/site-homework";
import { roundPairKey } from "../rounds";
import { isVideoHomeworkDate } from "../types";
import { ledgerRoundWriteError, loadVideoHomeworkTarget } from "./mark-write";
import { reconcileVideoHomework } from "./reconcile-outcomes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `kept` = 그날 보고서를 다른 선생님이 처음 써서 따로 낸 표시만 지웠다(숙제는 그대로 — 영상 과제 값은 그 선생님 것이다). */
export type CancelHomeworkResult = { ok: boolean; error?: string; kept?: true };

/** DB 함수(20261016130000)가 거절한 까닭 — 아무것도 안 바꿨다. */
const REFUSED: Record<string, string> = {
  submitted: "완료로 기록된 숙제는 취소할 수 없습니다. 기록을 미확인으로 되돌린 뒤 취소해 주세요.",
  has_video: "영상이 붙은 숙제는 취소할 수 없습니다. 영상을 반려하거나 다른 숙제로 옮긴 뒤 취소해 주세요.",
  uploading: "학생이 이 숙제에 올린 영상을 아직 받는 중입니다. 잠시 뒤 다시 확인해 주세요.",
  changed: "그사이 영상이나 기록이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.",
  missing: "취소할 숙제를 찾지 못했습니다. 화면을 새로고침해 주세요.",
};
const OTHERS_REPORT = "다른 선생님이 쓴 보고서의 영상 숙제는 그 선생님이나 관리자만 취소할 수 있습니다.";

/**
 * **영상 숙제 취소**(원장 2026-10-16 *"잘못 출제해서 없음으로 바꾸고 싶으면"* · *"미확인이나 미제출인 숙제에 한해서 숙제 취소할 수 있게"*).
 * 영상 제출 현황 칸 하나(반 × 학생 × 숙제일)를 거둔다 — 보고서를 이미 보낸 숙제도(원스크린은 보낸 줄을 잠근다).
 *  1. 권한 = 칸 편집과 같다(`ledgerRoundWriteError` — 수업보고서 전체 권한이거나 자기가 낸 숙제).
 *  2. 칸 상태는 **장부와 같은 판정**(`pairRounds` — 학생이 숙제를 안 고르고 올린 영상의 자동 짝 포함)으로 본다: 미확인 · 미수행만.
 *     완료이거나 영상이 붙은 칸은 거절한다.
 *  3. 그날 보고서의 '영상 과제'는 그 줄을 **처음 쓴 선생님** 것이다(report-owner.ts · 0336a 트리거) — 전체 권한이 아니고 남이 쓴
 *     보고서면 보고서는 그대로 두고 따로 낸 표시만 지운다(`kept`).
 *  4. DB 함수 `cancel_video_homework`가 한 거래로 보고서 '영상 과제 있음' → '없음' · 따로 낸 숙제 · 검사 기록 · 취소 기록을 쓴다.
 *     DB 사실(완료 기록 · 붙은 영상 · 받는 중 · 읽은 뒤 바뀜)로 한 번 더 거른다.
 * 🔴 ClassNote로 이미 나간 글은 다시 보내지 않는다 — 학생에게는 선생님이 알린다(화면 안내가 누르기 전에 말한다).
 */
export async function cancelVideoHomework(input: { classId: string; studentId: string; homeworkDate: string }): Promise<CancelHomeworkResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!input || !UUID.test(String(input.classId)) || !UUID.test(String(input.studentId)) || !isVideoHomeworkDate(input.homeworkDate))
    return { ok: false, error: "반·학생·숙제일을 확인해 주세요." };
  const { classId, studentId, homeworkDate } = input;
  const today = kstToday();
  if (homeworkDate > today) return { ok: false, error: "아직 나가지 않은 숙제입니다." };
  const db = createAdminClient();
  try {
    const denied = await ledgerRoundWriteError(db, user, { classId, studentId, homeworkDate });
    // 관문의 문장은 '기록' 축이다 — 여기서는 취소라고 말한다.
    if (denied) return { ok: false, error: denied.startsWith("내가 낸 숙제만") ? "내가 낸 숙제만 취소할 수 있습니다." : denied };
    const [target, level, report] = await Promise.all([
      loadVideoHomeworkTarget(db, user.tenantId, classId, studentId),
      accessLevelTenant(user.systemRole, "lesson_reports"),
      db.from("lesson_reports").select("created_by").eq("tenant_id", user.tenantId).eq("class_id", classId).eq("student_id", studentId)
        .eq("report_date", homeworkDate).eq("video_homework", true).limit(1).maybeSingle(),
    ]);
    if (target.error !== null) return { ok: false, error: target.error };
    if (report.error) throw new Error(`보고서 조회 실패: ${report.error.message}`);
    // 다른 강사 편집 모드면 화면의 강사가 주인이다(칸 편집 관문과 같은 축). 작성 계정이 빈 옛 줄은 누구 것도 아니라 막지 않는다.
    const author = (report.data?.created_by as string | null | undefined) ?? null;
    const touchReport = level === "full" || !author || author === ((await effectiveTeacherId()) ?? user.id);
    const pair = { classId, studentId };
    // 자료를 읽기 시작한 시각 — 그 뒤에 이 학생의 영상·배정·기록이 바뀌면 DB 함수가 'changed'로 돌려준다(판정한 칸이 낡았다).
    const observedAt = new Date().toISOString();
    const materials = await loadPairRoundMaterials(db, user.tenantId, [pair], today, { from: homeworkDate });
    if (!materials) return { ok: false, error: "영상 숙제를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    const round = (pairRounds(materials).get(roundPairKey(pair)) ?? []).find((r) => r.homeworkDate === homeworkDate);
    if (!round) return { ok: false, error: REFUSED.missing };
    if (touchReport && round.status === "submitted") return { ok: false, error: round.videoId ? REFUSED.has_video : REFUSED.submitted };
    if (touchReport && round.videoId) return { ok: false, error: REFUSED.has_video };
    // 그 칸에 붙어 있던 숙제일 없는 옛 기록 — 함께 지운다(남기면 숙제가 사라진 뒤 그 기록이 따로 칸으로 선다, 반려와 같은 규약).
    const legacyCheck = round.mark && !round.mark.homeworkDate ? round.mark.checkDate : null;
    const { data, error } = await db.rpc("cancel_video_homework", {
      p_tenant: user.tenantId, p_class: classId, p_student: studentId, p_date: homeworkDate, p_observed_at: observedAt,
      p_legacy_check: legacyCheck, p_touch_report: touchReport,
    });
    // 함수가 아직 없는 DB(SQL 적용 전) — 기능을 못 쓴다고만 알린다(#95).
    if (error?.code === "PGRST202") return { ok: false, error: "아직 사용할 수 없는 기능입니다. 잠시 뒤 다시 시도해 주세요." };
    if (error) throw new Error(`숙제 취소 실패: ${error.message}`);
    const result = String(data);
    if (result === "missing" && !touchReport) return { ok: false, error: OTHERS_REPORT };
    if (result !== "cancelled" && result !== "cancelled_report" && result !== "kept")
      return { ok: false, error: REFUSED[result] ?? "숙제를 취소하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
    await logAction({ action: "lesson_report_video_homework_cancel", targetType: "video_homework",
      targetLabel: [target.studentName, target.className].filter(Boolean).join(" · ") || null,
      metadata: { classId, studentId, homeworkDate, status: round.status, ...(round.due ? { due: round.due } : {}),
        ...(result === "cancelled_report" ? { fromReport: true } : {}), ...(result === "kept" ? { keptReport: true } : {}) } });
    // 응답 전에 끝낸다 — 판정 전 상태로 장부가 다시 그려지지 않게(반려·영상 배정과 같은 까닭). 실패해도 취소는 끝났다.
    try { await reconcileVideoHomework(user.tenantId, { studentId }); }
    catch (e) { reportError(e, { scope: "video-homework.after-cancel", tenantId: user.tenantId, studentId }); }
    revalidatePath("/onescreen/video-homework"); revalidatePath("/lesson-reports/video-homework"); revalidatePath(`/students/${studentId}`);
    return result === "kept" ? { ok: true, kept: true } : { ok: true };
  } catch (e) {
    reportError(e, { scope: "video-homework.cancel", tenantId: user.tenantId, studentId });
    return { ok: false, error: "숙제를 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}
