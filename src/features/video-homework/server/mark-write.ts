import "server-only";

import type { CurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isVideoHomeworkEnabled } from "../policy";
import { isOwnVideoHomework } from "./own-homework";
import type { VideoHomeworkStatus } from "../types";
import { explainDbError } from "@/lib/supabase/db-error";

type Db = ReturnType<typeof createAdminClient>;
export type MarkWriteResult = { ok: boolean; error?: string;
  /** 미확인으로 지웠어도 그 칸이 숙제로 남는다(옮겨 남긴 숙제 · 이미 숙제인 날, keep-round.ts) — 화면이 칸을 지우지 않는다. */
  kept?: true };

/** 수업보고서 전체 권한이거나, 그날 그 반을 맡은 강사인가(원스크린·영상 제출 현황 공용 게이트). */
export async function videoHomeworkWriteError(user: CurrentUser, classId: string, date: string): Promise<string | null> {
  if ((await accessLevelTenant(user.systemRole, "lesson_reports")) === "full") return null;
  if (!(await canWriteTenant(user.systemRole, "teacher_onescreen"))) return "수정 권한이 없습니다.";
  // 다른 강사 편집 모드도 화면에 표시된 강사 범위로 검사한다. 저장 행위자는 실제 로그인 계정 그대로다.
  const teacherId = (await effectiveTeacherId()) ?? user.id;
  const classes = await getTeachingClassIds(await createClient(), teacherId, date);
  return classes.all.includes(classId) ? null : "담당 반만 수정할 수 있습니다.";
}

/**
 * 영상 제출 현황(장부)의 칸을 찍을 수 있나 — 수업보고서 **전체 권한**이면 모든 칸, 아니면 **강사 쓰기 권한 + 자기가 낸 숙제 칸**만
 * (원장 2026-10-03 *"강사뷰에서도 수동 체크. 관리자와 동일하게 스스로 낸 숙제만 체크 하게"*). 낸 사람 = `isOwnVideoHomework`(own-homework.ts —
 * '영상 과제 있음' 보고서의 작성 계정 · 따로 낸 숙제의 선생님 · 그 밖의 검사 기록·옮겨 남긴 숙제 칸은 그날 보고서의 작성 계정).
 * 🔑 "그날 그 반 담당" 검사(`videoHomeworkWriteError`)는 장부에선 이것으로 대신한다 — 담임이 바뀐 반의 내 숙제도 내가 찍는다(그 판정은
 *    지금 담임을 봐서, 보이는 칸이 저장 때 "담당 반만"으로 거절됐다). 관리자 화면도 이 판정이라 편집 칸은 전체 권한일 때만 연다.
 * 숙제일 없는 옛 기록(c:)은 낸 사람을 몰라 강사는 찍지 않는다. 원스크린 검사(`setVideoHomeworkMark`)는 이 판정을 타지 않는다(예전 그대로).
 */
export async function ledgerRoundWriteError(db: Db, user: CurrentUser, input: { classId: string; studentId: string; homeworkDate: string | null }): Promise<string | null> {
  if ((await accessLevelTenant(user.systemRole, "lesson_reports")) === "full") return null;
  if (!(await canWriteTenant(user.systemRole, "teacher_onescreen"))) return "수정 권한이 없습니다.";
  const NOT_MINE = "내가 낸 숙제만 기록할 수 있습니다.";
  if (!input.homeworkDate) return "숙제일이 없는 옛 기록이라 여기서는 고칠 수 없습니다. 사무실에 알려 주세요.";
  try {
    const teacherId = (await effectiveTeacherId()) ?? user.id;
    return (await isOwnVideoHomework(db, { tenantId: user.tenantId, userId: teacherId, classId: input.classId, studentId: input.studentId, date: input.homeworkDate }))
      ? null : NOT_MINE;
  } catch {
    return "숙제를 낸 사람을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/** 그 반·학생이 있고 지금 설정으로 검사 대상인가 — 통과하면 감사로그에 쓸 이름을 돌려준다. */
export async function loadVideoHomeworkTarget(db: Db, tenantId: string, classId: string, studentId: string): Promise<
  { error: string } | { error: null; className: string; studentName: string; enabled: boolean }
> {
  const [classResult, studentResult, settings] = await Promise.all([
    db.from("classes").select("subject,class_name").eq("tenant_id", tenantId).eq("id", classId).maybeSingle(),
    db.from("students").select("grade,name").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle(),
    getTenantSettings(),
  ]);
  if (classResult.error || studentResult.error)
    return { error: classResult.error?.message ?? studentResult.error?.message ?? "조회하지 못했습니다." };
  if (!classResult.data || !studentResult.data) return { error: "해당 반이나 학생을 찾을 수 없습니다." };
  return { error: null, className: classResult.data.class_name ?? "", studentName: studentResult.data.name ?? "",
    enabled: isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId, subjectKey: classResult.data.subject, grade: studentResult.data.grade }) };
}

/**
 * 검사 기록 한 건을 쓴다 — **같은 숙제 = 한 줄**(원장 2026-10-01).
 *
 * 숙제를 가리키는 값은 `homeworkDate`다. 그 숙제의 기록이 이미 있으면(원스크린이 찍었든 영상 제출 현황이 찍었든, 어느 자리든)
 * 새 줄을 만들지 않고 **그 줄을 고친다**. 없을 때만 `slotDate` 자리에 새로 넣는다(저장 키 = 반·학생·check_date 그대로, 새 SQL 없음).
 *  · 원스크린 = 검사한 수업일 · 영상 제출 현황 = 숙제일 다음 날(그날 원스크린이 같은 숙제를 검사하는 자리라 다른 숙제와 안 겹친다).
 *  · 숙제일을 모르면(옛 기록·직전 수업을 못 읽은 원스크린) 예전처럼 `slotDate` 자리가 곧 그 기록이다.
 * 🔴 제출일은 보낸 쪽만 바꾼다 — 날짜를 안 보내는 원스크린 체크가 저장된 제출일을 지우지 않는다(미수행은 비운다).
 * 되돌리기(status null): 같은 숙제 줄 + 그 자리의 줄. `slotIsMine`(원스크린 = 그날 칸에 선 기록이 곧 지울 기록)이면 자리의 줄을
 * 숙제일과 무관하게 지운다(예전 동작 — 뒤늦게 끼운 보고서로 지난 수업일이 바뀌어도 되돌리기가 먹게). 장부는 숙제일이 같거나 빈 줄만.
 */
export async function writeVideoHomeworkMark(db: Db, input: {
  tenantId: string; userId: string; classId: string; studentId: string; slotDate: string; slotIsMine?: boolean;
  homeworkDate: string | null; submittedDate?: string | null; status: VideoHomeworkStatus | null;
}): Promise<MarkWriteResult> {
  const scoped = () => db.from("video_homework_marks").select("id")
    .eq("tenant_id", input.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId);
  const same = input.homeworkDate ? await scoped().eq("homework_date", input.homeworkDate) : null;
  if (same?.error) return { ok: false, error: explainDbError(same.error, { scope: "video-homework.mark-write.writeVideoHomeworkMark", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const sameIds = (same?.data ?? []).map((row) => row.id as string);

  if (input.status === null) {
    // 그날 자리의 기록은 숙제일이 같거나 비어 있을 때만 지운다 — 그 자리에 놓인 다른 숙제의 기록은 건드리지 않는다.
    const slot = input.homeworkDate && !input.slotIsMine
      ? await scoped().eq("check_date", input.slotDate).or(`homework_date.is.null,homework_date.eq.${input.homeworkDate}`)
      : await scoped().eq("check_date", input.slotDate);
    if (slot.error) return { ok: false, error: explainDbError(slot.error, { scope: "video-homework.mark-write.writeVideoHomeworkMark", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    const ids = [...new Set([...sameIds, ...(slot.data ?? []).map((row) => row.id as string)])];
    if (!ids.length) return { ok: true };
    const { error } = await db.from("video_homework_marks").delete().eq("tenant_id", input.tenantId).in("id", ids);
    return error ? { ok: false, error: explainDbError(error, { scope: "video-homework.mark-write.writeVideoHomeworkMark", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message } : { ok: true };
  }

  const values = {
    ...(input.status === "missing" ? { submitted_date: null }
      : input.submittedDate !== undefined ? { submitted_date: input.submittedDate } : {}),
    status: input.status,
    updated_by: input.userId,
    updated_at: new Date().toISOString(),
  };
  if (sameIds.length) {
    const { error } = await db.from("video_homework_marks").update(values).eq("tenant_id", input.tenantId).in("id", sameIds);
    return error ? { ok: false, error: explainDbError(error, { scope: "video-homework.mark-write.writeVideoHomeworkMark", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message } : { ok: true };
  }
  const { error } = await db.from("video_homework_marks").upsert({
    tenant_id: input.tenantId,
    class_id: input.classId,
    student_id: input.studentId,
    check_date: input.slotDate,
    homework_date: input.homeworkDate,
    ...values,
  }, { onConflict: "tenant_id,class_id,student_id,check_date" });
  return error ? { ok: false, error: explainDbError(error, { scope: "video-homework.mark-write.writeVideoHomeworkMark", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message } : { ok: true };
}
