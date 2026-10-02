import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { parseReleaseNames, type ReleaseBoard } from "../classnote-release-list";
import { summarizeSyncReport, toSyncRun, toSyncRunHead, type SyncReportSummary } from "../classnote-sync-report";

/**
 * 반 보드 동기화 보고서(0329a) — 서버 액션이 쓰는 조회(동기 export가 있어 `"use server"` 파일 밖에 둔다, [[#119]]).
 * 🔴 admin(service_role)이라 RLS를 우회한다 — **모든 조회에 tenant_id 필터**([[#104]]). 회차 표는 정책이 없어 사용자 클라이언트로는
 *    0행이다(전 반의 학생·원아 이름과 보류 사유가 담긴다) — 호출하는 서버 액션이 보고서 쓰기 권한을 먼저 확인한다.
 */
type Admin = ReturnType<typeof createAdminClient>;
type BoardRow = { class_id: string; board_name: string | null; release_names: unknown; release_checked_at: string | null };
/** 머리만(줄 제외) — 버튼 상태를 물을 때마다 읽는다. */
const HEAD_COLS = "kind, finished_at, ok, error, summary";
/** 줄까지 — 내려받을 때만 읽는다(회차당 최대 2,000줄). */
const RUN_COLS = `${HEAD_COLS}, events`;

/** 가장 최근 회차와 가장 최근 전체(매일) 동기화를 한 번에 읽는다. 표가 없으면(0329a 전, [[#95]]) throw. */
async function loadLatestRows(admin: Admin, tenantId: string, cols: string): Promise<{ latest: Record<string, unknown> | null; daily: Record<string, unknown> | null }> {
  const base = () => admin.from("classnote_board_sync_runs").select(cols).eq("tenant_id", tenantId).order("finished_at", { ascending: false }).limit(1);
  const [any, daily] = await Promise.all([base(), base().eq("kind", "daily")]);
  if (any.error) throw any.error;
  if (daily.error) throw daily.error;
  return {
    latest: ((any.data as unknown as Record<string, unknown>[] | null)?.[0] ?? null),
    daily: ((daily.data as unknown as Record<string, unknown>[] | null)?.[0] ?? null),
  };
}

/**
 * 가장 최근 회차(줄 포함) + (그것이 '지금 동기화'면) 가장 최근 전체 동기화. 회차가 하나도 없으면 latest=null.
 * 표가 없으면 throw — 호출부가 숨김·거절로 받는다.
 */
export async function loadSyncRuns(admin: Admin, tenantId: string) {
  const rows = await loadLatestRows(admin, tenantId, RUN_COLS);
  const latest = toSyncRun(rows.latest);
  return { latest, lastDaily: latest?.kind === "request" ? toSyncRun(rows.daily) : null };
}

/**
 * 워커가 해제 대상을 확인한 반 보드 전부(확인 전인 행은 뺀다 — 모르는 반을 '해제 없음'으로 세지 않는다).
 * 반 수만큼의 행이라 페이지로 전건을 읽는다(B2). 칸이 없으면 throw.
 */
async function loadCheckedBoards(admin: Admin, tenantId: string): Promise<BoardRow[]> {
  return fetchAllPaged<BoardRow>((from, to) =>
    admin
      .from("classnote_class_boards")
      .select("class_id, board_name, release_names, release_checked_at")
      .eq("tenant_id", tenantId)
      .not("release_checked_at", "is", null)
      .order("class_id", { ascending: true })
      .range(from, to),
  );
}

/** 해제 대상 목록 — `withClassNames`면 반 이름까지 붙인다(내려받기용. 요약에는 필요 없다). */
export async function loadReleaseBoards(admin: Admin, tenantId: string, { withClassNames = true } = {}): Promise<ReleaseBoard[]> {
  const rows = await loadCheckedBoards(admin, tenantId);
  // 반 이름은 해제할 원아가 있는 반만 읽는다(보드 이름과 다를 때 함께 적는 용도 — 못 읽어도 목록은 나간다).
  const withNames = withClassNames ? rows.filter((r) => parseReleaseNames(r.release_names).length) : [];
  const classes = await fetchInChunks<{ id: string; class_name: string | null }>(
    withNames.map((r) => r.class_id),
    (chunk) => admin.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", chunk),
  ).catch(() => []);
  const nameById = new Map(classes.map((c) => [c.id, c.class_name]));
  return rows.map((r) => ({
    boardName: r.board_name?.trim() || nameById.get(r.class_id)?.trim() || "이름 없는 반",
    className: nameById.get(r.class_id) ?? null,
    names: parseReleaseNames(r.release_names),
    checkedAt: r.release_checked_at!,
  }));
}

/**
 * 버튼 옆 요약 — 가장 최근 회차의 변동·실패·보류 수(워커가 적어 둔 숫자 — 줄은 읽지 않는다) + 전 반의 해제 대상 수
 * + 가장 최근 전체 동기화의 실패·멈춤. 회차 기록이 하나도 없거나(동기화 전·옛 워커) 표·칸이 없거나 못 읽으면 null
 * (버튼을 그리지 않는다 — 동기화 버튼은 그대로).
 */
export async function loadSyncReportSummary(admin: Admin, tenantId: string): Promise<SyncReportSummary | null> {
  try {
    const [rows, boards] = await Promise.all([loadLatestRows(admin, tenantId, HEAD_COLS), loadReleaseBoards(admin, tenantId, { withClassNames: false })]);
    const latest = toSyncRunHead(rows.latest);
    return latest ? summarizeSyncReport(latest, boards, toSyncRunHead(rows.daily)) : null;
  } catch {
    return null;
  }
}
