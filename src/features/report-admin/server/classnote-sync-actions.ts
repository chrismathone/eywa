"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { isAutoSyncRequest } from "./classnote-sync-auto";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { logAction } from "@/features/audit/server/log";
import { cooldownLeftMs, mergeScope, normalizeScope, staleReason, type SyncRequestRow } from "../classnote-sync";
import { isMissingTableError, loadSyncRows, loadWorkerSyncState, mergeIntoPending, workerAcceptsSyncRequests } from "./classnote-sync-core";
import { loadSyncReportSummary } from "./classnote-sync-report-core";
import type { SyncReportSummary } from "../classnote-sync-report";

/**
 * **지금 반 보드 동기화** — 버튼(0313a). 원장 2026-09-30 *"지금 반 보드 동기화 버튼을 만들자. 보고서 설정 말고도 실제로
 * 필요한 곳에 모두 만들고, 한번 누르면 다른곳에서 누르지 못하도록 중복 발동 방지작업"*.
 *
 * 🔴 중복 발동 방지 = DB가 지점당 살아 있는 요청 하나만 허락한다(부분 유니크). 부분 유니크는 `ON CONFLICT` 타깃이 안 되므로
 *    ([[#113]]) **그냥 insert**하고 23505 = "이미 요청됨"으로 받아 그 요청에 범위를 합친다.
 * 🔴 권한 = 보고서 쓰기(원장·관리자·매니저) + **강사**(원스크린 '보낼 반' 고르기에서 필요가 생긴다). 안전한 이유:
 *    요청은 ClassNote에 직접 쓰지 않고 워커가 **바뀐 반만**(상한 15개) 하루 동기화와 같은 가드로 돈다 + 지점당 하나 + 5분 쿨다운.
 *    '다른 강사 뷰'(열람 전용)는 막는다.
 * 🔴 ClassNote 모듈이 꺼진 지점은 없는 기능이다(버튼 숨김 + 요청 거절).
 * [[#95]] 0313a 적용 전 = `available:false`(버튼 숨김) · 옛 워커(caps.syncRequests 없음) = 요청을 받지 않는다(아무도 안 집는 '대기 중' 방지).
 */

/** 발송이 막혀 서버가 대신 낸 요청의 source 값 — 자동 요청 문맥 안에서만 기록된다. */
const AUTO_SOURCE = "send_blocked";
/** 누가 낸 요청인가 — 감사로그가 이 값으로 자동/수동을 가른다(서버가 실행 문맥으로 정한다). */
type SyncTrigger = "auto" | "manual";

type Gate = { ok: true; tenantId: string; userId: string; canExport: boolean } | { ok: false; error: string; hidden: boolean };

async function gate(): Promise<Gate> {
  // 강사뷰면 대상 X — '쓰기 권한 없는 강사' 판정(역할)과 요청 명의(requested_by)가 X 기준이다. A의 역할로 보면
  // 원장이 강사 X 화면에서 발송이 배정 보류로 막혔을 때 서버가 대신 내는 자동 동기화 요청까지 거절된다.
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다", hidden: true };
  const settings = await getTenantSettings();
  if (!classnoteModuleOn(settings)) return { ok: false, error: "사용할 수 없는 기능입니다", hidden: true };
  // 보고서 쓰기 권한 = 동기화 보고서(전 반의 학생·원아 이름과 보류 사유)까지 받을 수 있다. 강사는 동기화만 누른다(0329a).
  const canExport = await canWriteTenant(user.systemRole, "lesson_reports");
  // 선생님(보고서 쓰기 권한이 없는 강사)은 버튼으로 직접 요청할 수 없다 — 원스크린 발송이 배정 보류로 막혔을 때 서버가
  // 대신 내는 요청(runAsAutoSyncRequest)만 받는다. 상태 조회는 늘 숨겨 버튼 자체가 그려지지 않는다.
  // 운영자 계정은 이 제한에 걸리지 않는다(역할이 강사여도 — 새 제한은 운영자를 막지 않는다는 저장소 규칙). 그 조회는
  // 제한에 걸릴 계정에만 한다(평소 경로에 조회를 더하지 않는다).
  const teacherWithoutWrite = user.systemRole === "teacher" && !canExport;
  if (!canExport && !teacherWithoutWrite) return { ok: false, error: "반 보드 동기화 권한이 없습니다", hidden: true };
  if (teacherWithoutWrite && !isAutoSyncRequest() && !(await isCurrentUserSuperAdmin())) {
    return { ok: false, error: "선생님은 직접 동기화를 요청할 수 없습니다 — 발송이 막히면 자동으로 요청됩니다", hidden: true };
  }
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro, hidden: false };
  return { ok: true, tenantId: user.tenantId, userId: user.id, canExport };
}

export type ClassnoteSyncStatus = {
  available: boolean;
  workerReady: boolean;
  /** 연동 PC가 낮 동안 달라진 반을 스스로 맞추는가(자동 동기화가 켜진 새 버전) — 버튼 설명 문구만 가른다. */
  autoSync?: boolean;
  active: SyncRequestRow | null;
  latest: SyncRequestRow | null;
  /**
   * 동기화 보고서 요약(0329a) — 있으면 버튼 옆에 '동기화 보고서 다운로드'를 그린다. null = 권한 없음(강사)·표 미적용·
   * 워커가 아직 회차를 적은 적 없음. 동기화 상태와 **한 번에** 온다(화면이 마운트 때 서버를 두 번 부르지 않게).
   */
  report: SyncReportSummary | null;
  nowMs: number;
};

const HIDDEN: Omit<ClassnoteSyncStatus, "nowMs"> = { available: false, workerReady: false, active: null, latest: null, report: null };

/**
 * 버튼 상태 — 살아 있는 요청·마지막 결과·연동 PC 준비 여부. 읽기만 한다(멈춘 요청 정리는 요청 액션이 한다).
 * 반 보드를 한 번도 연결하지 않은 지점(0302a가 빔)은 동기화할 반 보드가 없어 버튼을 감춘다.
 */
export async function getClassnoteSyncStatus(): Promise<ClassnoteSyncStatus> {
  const nowMs = Date.now();
  const g = await gate();
  if (!g.ok) return { ...HIDDEN, nowMs };
  const admin = createAdminClient();
  try {
    const [rows, boards, worker, report] = await Promise.all([
      loadSyncRows(admin, g.tenantId),
      admin.from("classnote_class_boards").select("class_id", { count: "exact", head: true }).eq("tenant_id", g.tenantId),
      loadWorkerSyncState(admin, g.tenantId),
      // 동기화 보고서 요약 — 받을 수 있는 사람만 읽는다. 실패·표 없음은 null(버튼만 빠진다, 동기화 버튼은 그대로).
      g.canExport ? loadSyncReportSummary(admin, g.tenantId) : Promise.resolve(null),
    ]);
    if (boards.error || !boards.count) return { ...HIDDEN, nowMs };
    return { available: true, workerReady: worker.ready, autoSync: worker.autoSync, active: rows.active, latest: rows.latest, report, nowMs };
  } catch (e) {
    // 표가 없다(0313a 적용 전) = 없는 기능처럼 감춘다. 그 밖의 조회 실패도 버튼을 감춘다(버튼은 편의일 뿐 — 새벽 동기화는 그대로).
    if (!isMissingTableError(e)) console.error("[classnote-sync] 상태 조회 실패", e);
    return { ...HIDDEN, nowMs };
  }
}

export type RequestSyncResult =
  | { ok: true; status: ClassnoteSyncStatus; message: string }
  | { ok: false; error: string; status?: ClassnoteSyncStatus };

/**
 * 동기화 요청. `scope`가 없으면 **바뀐 반 전부**(워커가 0302a 기록과 aywa를 대조해 차이만 돈다),
 * 있으면 그 반·학생만(원스크린 '보낼 반' 고르기 등 — 누른 자리가 아는 반·학생).
 */
export async function requestClassnoteBoardSync(input?: { classIds?: string[]; studentIds?: string[]; source?: string }): Promise<RequestSyncResult> {
  const g = await gate();
  if (!g.ok) return { ok: false, error: g.error };
  const admin = createAdminClient();
  let scope = normalizeScope({ classIds: input?.classIds, studentIds: input?.studentIds });
  // 🔴 자동 요청인지는 **서버가 정한다** — 호출자가 준 source로 가르면 버튼을 누른 사람이 값을 꾸며 '자동'으로 남길 수 있다.
  //    문맥 밖(사람이 낸 요청)에서 자동 요청 전용 값이 오면 싣지 않는다.
  const auto = isAutoSyncRequest();
  const rawSource = typeof input?.source === "string" ? input.source.slice(0, 40) : null;
  const source = !auto && rawSource === AUTO_SOURCE ? null : rawSource;
  const trigger: SyncTrigger = auto ? "auto" : "manual";
  const now = Date.now();

  let rows: Awaited<ReturnType<typeof loadSyncRows>>;
  try {
    rows = await loadSyncRows(admin, g.tenantId);
  } catch (e) {
    if (isMissingTableError(e)) return { ok: false, error: "사용할 수 없는 기능입니다" };
    return { ok: false, error: "동기화 상태를 확인하지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }

  // ① 멈춘 요청(연동 PC 꺼짐·실행 중 멈춤) — 실패로 내리고 새로 받는다. 조건부 update라 워커가 방금 집었으면 0행(그대로 둔다).
  if (rows.active) {
    const stale = staleReason(rows.active, now);
    if (stale) {
      // 멈춘 실행 중 요청에 합류해 있던 범위(next_scope)는 새 요청에 싣는다 — 버리면 합류한 반이 새벽까지 밀린다.
      if (rows.active.nextScope) scope = mergeScope(scope, rows.active.nextScope);
      await admin
        .from("classnote_sync_requests")
        .update({ status: "failed", finished_at: new Date(now).toISOString(), error: stale, result: { timedOut: true } })
        .eq("tenant_id", g.tenantId)
        .eq("id", rows.active.id)
        .eq("status", rows.active.status);
      rows = await loadSyncRows(admin, g.tenantId).catch(() => rows);
    }
  }

  // ② 이미 살아 있는 요청 — 새로 만들지 않는다. 대기 중이면 범위를 합치고, 실행 중이면 next_scope에 적어 끝난 뒤 이어서 돈다.
  if (rows.active && !staleReason(rows.active, now)) {
    const merged = await mergeIntoPending(admin, g.tenantId, rows.active, scope);
    await logJoin(rows.active.id, scope, source, trigger);
    const status = await getClassnoteSyncStatus();
    return {
      ok: true,
      status,
      message:
        rows.active.status === "running"
          ? "이미 동기화가 실행 중입니다 — 끝나면 이어서 한 번 더 동기화합니다"
          : merged
            ? "이미 요청돼 있어 이 반도 함께 동기화하도록 합쳤습니다"
            : "이미 요청돼 연동 PC를 기다리는 중입니다",
    };
  }

  // ③ 쿨다운 — 방금 끝났으면 기다린다(ClassNote 로그인·조회 폭주 방지). 서버에서 강제한다(화면 잠금만으론 우회된다).
  const left = cooldownLeftMs(rows.latest, now);
  if (left > 0) return { ok: false, error: `조금 전에 동기화했습니다 — ${Math.ceil(left / 60_000)}분 뒤 다시 누를 수 있습니다` };

  // ④ 연동 PC가 받을 수 있는가 — 꺼졌거나 옛 버전이면 아무도 안 집어 영원히 '대기 중'이 된다.
  if (!(await workerAcceptsSyncRequests(admin, g.tenantId)))
    return { ok: false, error: "연동 PC가 꺼져 있거나 옛 버전이라 지금 동기화를 받을 수 없습니다 — 새벽 5시 정기 동기화는 그대로 돕니다" };

  // ⑤ 넣는다. 23505 = 그 사이 다른 화면에서 먼저 눌렀다 → 그 요청에 합친다.
  const { data, error } = await admin
    .from("classnote_sync_requests")
    .insert({ tenant_id: g.tenantId, requested_by: g.userId, scope })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") {
      const again = await loadSyncRows(admin, g.tenantId).catch(() => null);
      if (again?.active) {
        await mergeIntoPending(admin, g.tenantId, again.active, scope);
        await logJoin(again.active.id, scope, source, trigger);
      }
      return { ok: true, status: await getClassnoteSyncStatus(), message: "다른 곳에서 먼저 요청해 그 요청과 함께 동기화합니다" };
    }
    if (isMissingTableError(error)) return { ok: false, error: "사용할 수 없는 기능입니다" };
    return { ok: false, error: "동기화를 요청하지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }

  await logAction({
    action: "classnote_board_sync_request",
    targetType: "classnote_sync",
    targetLabel: scope.full ? "반 보드 동기화(바뀐 반 전부)" : `반 보드 동기화(반 ${scope.classIds.length} · 학생 ${scope.studentIds.length})`,
    metadata: { requestId: data?.id ?? null, full: scope.full, classCount: scope.classIds.length, studentCount: scope.studentIds.length, source, trigger },
  });
  return { ok: true, status: await getClassnoteSyncStatus(), message: "요청했습니다 — 연동 PC가 곧 바뀐 반만 동기화합니다" };
}

/** 이미 살아 있는 요청에 합류한 것도 남긴다 — 누가 눌렀는지가 사실이다(makeedu 지금 동기화와 같은 규약). */
async function logJoin(requestId: string, scope: ReturnType<typeof normalizeScope>, source: string | null, trigger: SyncTrigger): Promise<void> {
  await logAction({
    action: "classnote_board_sync_request",
    targetType: "classnote_sync",
    targetLabel: "반 보드 동기화(이미 요청된 동기화에 합류)",
    metadata: { requestId, joined: true, full: scope.full, classCount: scope.classIds.length, studentCount: scope.studentIds.length, source, trigger },
  });
}
