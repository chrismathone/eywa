"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { logAction } from "@/features/audit/server/log";
import { homeworkOpen } from "../due";
import { loadPairRoundMaterials, pairRounds } from "@/features/video-submit/server/site-homework";
import { readPinnedVideoDriveCredential } from "@/features/video-submit/server/drive-credentials";
import { driveRequest, trashDriveFile } from "@/features/video-submit/server/drive-api";
import { roundPairKey, type RoundOwners } from "../rounds";
import { isVideoHomeworkDate } from "../types";
import { ledgerRoundWriteError, loadVideoHomeworkTarget } from "./mark-write";
import { reconcileVideoHomework } from "./reconcile-outcomes";
import { rejectionsReady } from "./rejections";
import { rejectTargets } from "../reject-targets";
import { keepMarkOnlyRound } from "./keep-round";
import { homeworkVideoSource } from "./video-source";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON = "미확인으로 되돌림 — 영상 반려(Drive 휴지통)";
/** DB 함수가 한 번에 받는 영상 수 상한(0414a) — 넘으면 함수는 'invalid'라 원인을 여기서 먼저 알린다. */
const MAX_VIDEOS = 50;

export type RejectResult = {
  ok: boolean; error?: string; rejected?: number;
  /** Drive 휴지통으로 옮긴 수 · 못 옮긴 수 · 다른 영상 줄과 같은 파일이라 남겨 둔 수. */
  trashed?: number; trashFailed?: number; trashShared?: number;
  /** 마감(선생님이 고른 다음 수업 또는 숙제일 + 7일, due.ts) 안이라 학생이 다시 올릴 수 있다. */
  reopened?: boolean;
};

/**
 * **영상이 붙은 칸을 미확인으로 되돌리기 = 그 숙제의 영상 반려**(원장 2026-10-13 *"선생님이 미확인으로 다시 변경해놓으면 업로드 가능하게"* ·
 * *"이미 업로드된 배정 영상은 드라이브에서 삭제하거나 조치"* → Drive 휴지통 · 그 숙제에 붙은 영상 전부).
 *  1. 반려할 영상 = 지금 그 칸에 붙어 있는 영상 전부(`rejectTargets` — 대표 · 그 숙제를 고른 영상 · 그 칸으로 접힌 같은 날 영상과 같은 파일 사본).
 *     다른 숙제의 영상은 건드리지 않는다.
 *  2. DB 함수 `reject_homework_videos`가 **한 거래로** 반려 표시(그 시각에 이미 있던 영상은 그 칸에 다시 안 붙는다) · 집계 제외(배정 이력에
 *     사유·처리자) · 그 숙제의 검사 기록 삭제를 한다. 그사이 영상 연결이 바뀌었으면 아무것도 안 바꾸고 'changed'.
 *  3. Drive 파일은 업로드 때 각인된 폴더·계정 자격으로 **휴지통**(30일 복구). 다른 영상 줄이 같은 파일을 쓰면 남겨 둔다. 못 옮겨도 반려는 그대로다.
 *  4. 마감(due.ts — 기본 숙제일 + 7일) 안이면 그 숙제가 올리기 사이트 목록에 다시 선다, 지났으면 미수행이 된다.
 * 권한 = 칸 편집과 같다(`ledgerRoundWriteError` — 수업보고서 전체 권한이거나 자기가 낸 숙제).
 */
export async function rejectHomeworkVideos(input: { classId: string; studentId: string; homeworkDate: string }): Promise<RejectResult> {
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
    if (denied) return { ok: false, error: denied };
    if (!(await rejectionsReady(db))) return { ok: false, error: "아직 사용할 수 없는 기능입니다. 잠시 뒤 다시 시도해 주세요." };
    const target = await loadVideoHomeworkTarget(db, user.tenantId, classId, studentId);
    if (target.error !== null) return { ok: false, error: target.error };
    const pair = { classId, studentId };
    // 자료를 읽기 시작한 시각 — 그 뒤에 이 학생의 영상·배정이 바뀌면 DB 함수가 'changed'로 돌려준다(고른 목록이 낡았다).
    const observedAt = new Date().toISOString();
    const materials = await loadPairRoundMaterials(db, user.tenantId, [pair], today, { from: homeworkDate });
    if (!materials) return { ok: false, error: "영상 숙제를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    // 칸마다 센 영상은 기간 밖 칸(앞선 숙제)까지 채운다 — 판정은 장부가 칸에 붙인 그대로(`rejectTargets`).
    const owners: RoundOwners = new Map();
    const rounds = pairRounds(materials, owners).get(roundPairKey(pair)) ?? [];
    const targets = rejectTargets(rounds, owners, materials.videos, classId, homeworkDate);
    if (!targets.length) return { ok: false, error: "이 숙제에 붙은 영상이 없습니다. 화면을 새로고침해 주세요." };
    if (targets.length > MAX_VIDEOS) return { ok: false, error: `이 숙제에 붙은 영상이 ${targets.length}개라 한 번에 반려할 수 없습니다(최대 ${MAX_VIDEOS}개). 영상을 먼저 다른 숙제로 옮겨 주세요.` };
    // 그 칸에 붙어 있던 숙제일 없는 옛 기록 — 남기면 반려 뒤에도 칸이 그 기록(예: 완료)으로 보인다.
    const round = rounds.find((r) => r.homeworkDate === homeworkDate);
    const mark = round?.mark;
    // 검사 기록만으로 선 숙제 칸이면 반려 전에 따로 낸 숙제로 남긴다 — 기록을 지우면 칸이 사라져 반려 표시도 설 자리가 없다(keep-round.ts).
    const keep = round && !round.assigned && !round.kept ? await keepMarkOnlyRound(db, user.tenantId, user.id, { classId, studentId, date: homeworkDate }) : null;
    if (keep === "failed") return { ok: false, error: "숙제 칸을 남기지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    const legacyCheck = mark && !mark.homeworkDate ? mark.checkDate : null;
    const source = await homeworkVideoSource(db);
    const rows = await fetchInChunks<{ id: string; drive_file_id: string | null; route: unknown }>(targets, (chunk) =>
      db.from(source).select("id,drive_file_id,route").eq("tenant_id", user.tenantId).eq("student_id", studentId).in("id", chunk));
    // 반려 표시 · 영상 떼기 · 검사 기록 지우기는 DB 함수 한 거래로(0414a) — 하나라도 안 되면 아무것도 안 바뀐다.
    // 그사이 다른 반·숙제로 옮겨진 영상이 하나라도 있으면 함수가 'changed'로 돌려주고 아무것도 안 바꾼다.
    const { data, error } = await db.rpc("reject_homework_videos", {
      // 권한은 위에서 칸 편집과 같은 관문으로 확인했다(자기가 낸 숙제거나 전체 권한).
      p_tenant: user.tenantId, p_actor: user.id, p_student: studentId, p_class: classId, p_date: homeworkDate, p_videos: targets, p_reason: REASON,
      p_observed_at: observedAt, p_legacy_check: legacyCheck,
    });
    if (error) throw new Error(`반려 실패: ${error.message}`);
    if (data === "changed") return { ok: false, error: "그사이 영상 연결이 바뀌었습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
    if (data !== "rejected") return { ok: false, error: "영상을 반려하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요." };
    const routeOf = (row: { route: unknown }) => (row.route && typeof row.route === "object" ? row.route as Record<string, unknown> : {});
    const trash = await trashFiles(db, user.tenantId, rows.map((row) => ({ id: row.id, fileId: row.drive_file_id, route: routeOf(row) })));
    // 학생이 다시 올릴 수 있나 = 그 숙제의 마감 안(due.ts — 선생님이 고른 '다음 수업' 또는 숙제일 + 7일).
    const reopened = homeworkOpen(homeworkDate, today, round?.due);
    await logAction({ action: "lesson_report_video_homework_reject", targetType: "video_homework",
      targetLabel: [target.studentName, target.className].filter(Boolean).join(" · ") || null,
      metadata: { classId, studentId, homeworkDate, videos: targets.length, ...trash, reopened, ...(keep === "kept" ? { keptAsIssue: true } : {}) } });
    // 응답 전에 끝낸다 — 판정 전 상태로 장부가 다시 그려지지 않게(원장 2026-10-14, 영상 배정과 같은 까닭). 실패해도 반려는 끝났다.
    try { await reconcileVideoHomework(user.tenantId, { studentId }); }
    catch (error) { reportError(error, { scope: "video-homework.after-reject", tenantId: user.tenantId, studentId }); }
    revalidatePath("/onescreen/video-homework"); revalidatePath("/lesson-reports/video-homework"); revalidatePath(`/students/${studentId}`);
    return { ok: true, rejected: targets.length, ...trash, reopened };
  } catch (error) {
    reportError(error, { scope: "video-homework.reject", tenantId: user.tenantId, studentId });
    return { ok: false, error: "영상을 반려하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}

/** 반려한 영상의 Drive 파일을 휴지통으로 — 다른 영상 줄이 같은 파일을 쓰면 남겨 둔다. 실패는 세기만 한다(반려는 그대로). */
async function trashFiles(db: ReturnType<typeof createAdminClient>, tenantId: string,
  files: { id: string; fileId: string | null; route: Record<string, unknown> }[]): Promise<{ trashed: number; trashFailed: number; trashShared: number }> {
  let trashed = 0, trashFailed = 0, trashShared = 0;
  const ids = new Set(files.map((f) => f.id));
  for (const file of files) {
    if (!file.fileId) continue;
    try {
      const shared = await db.from("student_homework_videos").select("id").eq("tenant_id", tenantId).eq("drive_file_id", file.fileId).limit(20);
      if (shared.error) throw new Error("같은 파일 확인 실패");
      if ((shared.data ?? []).some((row) => !ids.has(String(row.id)))) { trashShared++; continue; }
      const rootId = typeof file.route.rootId === "string" ? file.route.rootId : null;
      const credential = rootId ? await readPinnedVideoDriveCredential(db, tenantId, rootId, typeof file.route.connectionId === "string" ? file.route.connectionId : null) : null;
      if (!credential) { trashFailed++; continue; }
      await trashDriveFile(driveRequest(credential.accessToken), file.fileId);
      trashed++;
    } catch (error) {
      trashFailed++;
      reportError(error, { scope: "video-homework.reject-trash", tenantId });
    }
  }
  return { trashed, trashFailed, trashShared };
}
