import "server-only";
import { RUN_LOCK_STALE_MS } from "../google-push";
import type { Admin } from "./google-sync-core";

/**
 * `calendar_sync_state`(0310a) 읽기·쓰기 — 캘린더마다 푸시 채널과 증분 동기화 시작점을 적는다.
 *
 * 🔴 **SQL보다 앱이 먼저 배포돼도 죽지 않는다**([[#95]]) — 표가 없으면(PostgREST 42P01/PGRST205) 이 모듈은
 *    "상태 없음"으로 답하고, 웹훅·채널은 조용히 꺼진 채 하루 2회 전체 임포트만 돈다.
 * ⚠️ service_role 전용 표다(사용자 정책 없음 — 마이그레이션에 '의도적 제외'로 적었다). 모든 쿼리에 tenant_id.
 */

export type SyncStateRow = {
  tenant_id: string;
  calendar_id: string;
  channel_id: string | null;
  channel_token: string | null;
  resource_id: string | null;
  channel_expires_at: string | null;
  last_synced_at: string | null;
  running_since: string | null;
  dirty: boolean;
};

/** 표가 아직 없다는 오류인가(SQL 미적용). 이때만 조용히 넘어가고, 다른 오류는 던진다. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  return error.code === "42P01" || error.code === "PGRST205" || (/calendar_sync_state/.test(msg) && /does not exist|schema cache/.test(msg));
}

const TABLE = "calendar_sync_state";

/** 채널 id로 한 줄 — 웹훅이 부른다. 테넌트는 **이 줄에서** 얻는다(요청을 믿지 않는다). */
export async function findByChannel(admin: Admin, channelId: string): Promise<SyncStateRow | null> {
  const { data, error } = await admin.from(TABLE).select("*").eq("channel_id", channelId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`calendar_sync_state 조회 실패: ${error.message}`);
  }
  return (data as SyncStateRow | null) ?? null;
}

/** 테넌트의 캘린더별 상태. 표가 없으면 `null`(= 기능 꺼짐). */
export async function listStates(admin: Admin, tenantId: string): Promise<SyncStateRow[] | null> {
  const { data, error } = await admin.from(TABLE).select("*").eq("tenant_id", tenantId);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`calendar_sync_state 조회 실패: ${error.message}`);
  }
  return (data as SyncStateRow[]) ?? [];
}

/** 한 줄 쓰기(없으면 만든다). 표가 없으면 아무 일도 안 한다. */
export async function upsertState(
  admin: Admin,
  tenantId: string,
  calendarId: string,
  patch: Partial<Omit<SyncStateRow, "tenant_id" | "calendar_id">>,
): Promise<void> {
  const { error } = await admin
    .from(TABLE)
    .upsert({ tenant_id: tenantId, calendar_id: calendarId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,calendar_id" });
  if (error && !isMissingTable(error)) throw new Error(`calendar_sync_state 쓰기 실패: ${error.message}`);
}

/** 잠금 결과 — `locked` 내가 잡음 · `deferred` 돌고 있는 회차에 '한 번 더'를 맡김 · `unavailable` 표 없음(SQL 전). */
export type LockResult =
  | { status: "locked"; token: string }
  | { status: "deferred" }
  | { status: "unavailable" };

/**
 * 동시 실행 잠금 — 한 캘린더에 한 회차만 돈다(웹훅 증분 · 하루 2회 전체 임포트 **둘 다** 이 잠금을 지난다 —
 * 둘이 겹치면 같은 일정 삽입이 유일 인덱스에 부딪혀 한쪽 회차가 실패한다). 오래 걸린 잠금(`RUN_LOCK_STALE_MS`)은 죽은 것으로 본다.
 * 🔴 조건부 UPDATE 한 번이라 두 요청이 동시에 와도 하나만 잡는다. 줄이 없으면 먼저 만든다(없는 줄은 못 잡는다).
 * 🔴 못 잡으면 **돌고 있는 줄에만** `dirty`를 세운다 — 그 사이 돌던 회차가 끝나 풀렸으면(0행) 다시 잡으러 간다
 *    (그냥 dirty만 세우면 방금 끝난 회차가 못 보고 알림이 사라진다).
 */
export async function acquireLock(admin: Admin, tenantId: string, calendarId: string): Promise<LockResult> {
  const { error: seedErr } = await admin
    .from(TABLE)
    .upsert({ tenant_id: tenantId, calendar_id: calendarId }, { onConflict: "tenant_id,calendar_id", ignoreDuplicates: true });
  if (seedErr) {
    if (isMissingTable(seedErr)) return { status: "unavailable" };
    throw new Error(`calendar_sync_state 준비 실패: ${seedErr.message}`);
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const staleBefore = new Date(Date.now() - RUN_LOCK_STALE_MS).toISOString();
    // 이 값이 내 잠금 표식이다 — 풀 때 **이 값일 때만** 푼다(5분 뒤 남이 가져간 잠금을 내가 풀지 않게).
    const token = new Date().toISOString();
    const { data, error } = await admin
      .from(TABLE)
      .update({ running_since: token, dirty: false })
      .eq("tenant_id", tenantId)
      .eq("calendar_id", calendarId)
      .or(`running_since.is.null,running_since.lt.${staleBefore}`)
      .select("calendar_id");
    if (error) throw new Error(`calendar_sync_state 잠금 실패: ${error.message}`);
    if ((data?.length ?? 0) > 0) return { status: "locked", token };
    const { data: marked, error: mErr } = await admin
      .from(TABLE)
      .update({ dirty: true })
      .eq("tenant_id", tenantId)
      .eq("calendar_id", calendarId)
      .not("running_since", "is", null)
      .select("calendar_id");
    if (mErr) throw new Error(`calendar_sync_state 표시 실패: ${mErr.message}`);
    if ((marked?.length ?? 0) > 0) return { status: "deferred" };
  }
  return { status: "deferred" };
}

/**
 * 잠금 풀기(+ 주면 시작점 전진). 도는 동안 새 알림이 왔으면(dirty) true — 한 번 더 돌아야 한다.
 * dirty는 여기서 지우지 않는다 — 다음 `acquireLock`이 잡는 순간 지운다(못 돌고 끝나도 표식이 남아 다음 알림이 본다).
 */
export async function unlock(
  admin: Admin,
  tenantId: string,
  calendarId: string,
  token: string,
  syncedFrom: string | null,
): Promise<boolean> {
  // 🔴 내 표식일 때만 — 오래 걸려 남이 가져간(RUN_LOCK_STALE_MS) 잠금을 내가 풀면 새 주인이 겹쳐 돈다.
  const { data } = await admin
    .from(TABLE)
    .update({ running_since: null, ...(syncedFrom ? { last_synced_at: syncedFrom } : {}) })
    .eq("tenant_id", tenantId)
    .eq("calendar_id", calendarId)
    .eq("running_since", token)
    .select("dirty")
    .maybeSingle();
  return !!(data as { dirty?: boolean } | null)?.dirty;
}
