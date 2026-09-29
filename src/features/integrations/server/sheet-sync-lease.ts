import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/** 리스 stale 한도 — 시트 반영/가져오기 1회는 보통 수십 초. 3분 넘으면 죽은 리스로 보고 재클레임 허용. */
const LEASE_STALE_MS = 3 * 60 * 1000;

export type SheetSyncLease = "claimed" | "busy" | "norow";

/** 선점 실패 시 사용자 안내 — 호출부 공용 문구(한글, raw 코드 노출 금지 규칙). */
export const SHEET_SYNC_BUSY_MSG =
  "다른 관리자가 이 시트를 작업 중입니다(시트로 보내기 또는 가져오기). 잠시 후 다시 시도하세요.";

/**
 * 시트 동기화 리스 claim — user_integrations(tenant×provider) 행의 sync_started_at을 **원자 UPDATE**로 선점.
 * 창=iframe 멀티윈도우·복수 master의 동시 실행을 서버에서 직렬화한다(클라 disabled는 한 창만 커버,
 * 2026-07-13 전수조사). 시트 셀 데이터는 drive.files.update 통째 교체라 원자적이지만, 후속
 * CLIP 서식·수식 batchUpdate가 동시 재교체와 겹치면 stale sheetId 400(허위 실패 토스트)이 나므로
 * 애초에 한 번에 하나만 실행되게 한다. makeedu 공유 락(getMakeeduSyncLock)과 같은 DB 파생 락 계열.
 *
 * 반환: "claimed"=선점 성공 / "busy"=다른 실행 진행 중(3분 이내) / "norow"=연동 행 없음
 * (파일 업로드 가져오기 등 시트 미연동 경로 — 보호할 시트가 없으니 호출부는 그냥 진행).
 *
 * `tenantId`: 세션 없는 호출(cron 자동 반영 = admin 클라이언트, RLS 우회)에서 **필수** — 명시 격리.
 * 세션(RLS) 경로는 생략(RLS가 테넌트를 이미 좁힘, 기존 호출 무변경).
 */
export async function claimSheetSyncLease(
  supabase: Supa,
  provider: string,
  tenantId?: string,
): Promise<SheetSyncLease> {
  const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  let claim = supabase
    .from("user_integrations")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("provider", provider)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleIso}`);
  if (tenantId) claim = claim.eq("tenant_id", tenantId);
  const { data } = await claim.select("provider");
  if ((data ?? []).length > 0) return "claimed";
  // 선점 실패 — 행이 있으면 진행 중(busy), 없으면 시트 미연동(norow).
  let probe = supabase.from("user_integrations").select("provider").eq("provider", provider);
  if (tenantId) probe = probe.eq("tenant_id", tenantId);
  const { data: row } = await probe.maybeSingle();
  return row ? "busy" : "norow";
}

/**
 * 저장된 `sync_started_at` 하나로 "지금 리스가 잡혀 있나"를 판정(순수) — 시간표 툴바가 폴링해
 * '시트로 보내기/가져오기' 버튼을 선제 비활성+안내한다(새벽 자동 반영·다른 관리자 수동 실행 모두 커버.
 * 서버 액션의 리스 거부가 그대로 2차 방어).
 *
 * 🔴 stale 한도(3분)를 호출부에 복사하지 말 것 — 여기가 단일 소스다(claim 쪽과 같은 값이어야
 *    "화면은 잠겨 있는데 서버는 통과"(또는 그 반대)가 안 생긴다).
 */
export function isLeaseActive(syncStartedAt: string | null | undefined): boolean {
  if (!syncStartedAt) return false;
  const at = new Date(syncStartedAt).getTime();
  return Number.isFinite(at) && Date.now() - at < LEASE_STALE_MS;
}

/**
 * 진행 중 리스 **갱신(heartbeat)** — 한 번에 끝나지 않고 **여러 콜에 걸쳐 순회**하는 경로용
 * (ECS 시트 가져오기: 반 28개를 한 반씩 = 1분+). 갱신이 없으면 순회 중에 3분 stale이 지나
 * 다른 사람이 끼어들 수 있다.
 *
 * ⚠️ **이미 잡혀 있을 때만 갱신한다**(`sync_started_at is not null`) — 무조건 UPDATE로 만들면
 * 이미 해제된 리스를 되살려(부활) 아무도 못 쓰는 유령 리스가 된다.
 */
export async function touchSheetSyncLease(
  supabase: Supa,
  provider: string,
  tenantId?: string,
): Promise<void> {
  let q = supabase
    .from("user_integrations")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("provider", provider)
    .not("sync_started_at", "is", null);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  await q;
}

/** 리스 해제 — 이 쓰기가 실패해도 3분 stale로 자가 회복하므로 best-effort면 충분. */
export async function releaseSheetSyncLease(
  supabase: Supa,
  provider: string,
  tenantId?: string,
): Promise<void> {
  let q = supabase.from("user_integrations").update({ sync_started_at: null }).eq("provider", provider);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  await q;
}
