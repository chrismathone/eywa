"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { logAction } from "@/features/audit/server/log";
import type { ReleaseBoard } from "../classnote-release-list";
import { buildSyncReportText, summarizeSyncReport, syncReportFilename, type SyncRun } from "../classnote-sync-report";
import { loadReleaseBoards, loadSyncRuns } from "./classnote-sync-report-core";

/**
 * ClassNote 반 보드 **동기화 보고서 내려받기**(0329a, 원장 2026-10-02 *"반 동기화 하고 그럼 우측에 '동기화 보고서 다운로드'가
 * 나와야겠어 … 모든 변동된 리스트 · 변동실패한 리스트 · 모든 이유"*).
 *
 * 🔴 권한 = 보고서 쓰기(원장·관리자·매니저)만 — '지금 동기화'는 강사도 누르지만, 이 보고서는 **전 반의 학생·원아 이름과 보류 사유**라
 *    강사에겐 주지 않는다. 버튼을 그릴지는 `getClassnoteSyncStatus`가 같은 권한으로 정한다.
 * 🔴 ClassNote 모듈이 꺼진 지점은 없는 기능이다(버튼 숨김 + 내려받기 거절).
 */
export type SyncReportDownload = { ok: true; filename: string; text: string } | { ok: false; error: string };

/** 동기화 보고서 글(txt) — 가장 최근 회차 + 전 반의 해제 대상. 내려받은 사실은 감사로그에 남긴다(이름이 나가는 파일). */
export async function downloadClassnoteSyncReport(): Promise<SyncReportDownload> {
  const denied: SyncReportDownload = { ok: false, error: "동기화 보고서를 내려받을 권한이 없습니다" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const settings = await getTenantSettings();
  if (!classnoteModuleOn(settings)) return denied;
  if (!(await canWriteTenant(user.systemRole, "lesson_reports"))) return denied;
  const admin = createAdminClient();
  let runs: { latest: SyncRun | null; lastDaily: SyncRun | null };
  let boards: ReleaseBoard[];
  try {
    [runs, boards] = await Promise.all([loadSyncRuns(admin, user.tenantId), loadReleaseBoards(admin, user.tenantId)]);
  } catch {
    return { ok: false, error: "동기화 보고서를 읽지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }
  const { latest, lastDaily } = runs;
  if (!latest) return { ok: false, error: "아직 동기화 기록이 없습니다 — 반 보드 동기화가 한 번 끝난 뒤 내려받을 수 있습니다" };
  const summary = summarizeSyncReport(latest, boards, lastDaily);
  await logAction({
    action: "classnote_board_sync_report_export",
    targetType: "classnote_sync",
    targetLabel: "반 보드 동기화 보고서",
    metadata: {
      finishedAt: summary.finishedAt,
      ok: summary.ok,
      changed: summary.changed,
      failed: summary.failed,
      held: summary.held,
      releaseNames: summary.releaseNames,
      releaseClasses: summary.releaseClasses,
    },
  });
  return {
    ok: true,
    filename: syncReportFilename(latest.finishedAt),
    text: buildSyncReportText({ latest, lastDaily, boards, academyName: settings.profile.name ?? null }),
  };
}
