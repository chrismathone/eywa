import "server-only";
import type { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;

/** 리스 stale 한도 — 시트 반영/가져오기 1회는 보통 수십 초. 3분 넘으면 죽은 리스로 보고 재클레임 허용. */
const LEASE_STALE_MS = 3 * 60 * 1000;

export type SheetSyncLease = "claimed" | "busy" | "norow";

/** 선점 실패 시 사용자 안내 — 호출부 공용 문구(한글, raw 코드 노출 금지 규칙). */
export const SHEET_SYNC_BUSY_MSG =
  "다른 관리자가 이 시트를 작업 중입니다(시트 반영 또는 가져오기). 잠시 후 다시 시도하세요.";

/**
 * 시트 동기화 리스 claim — user_integrations(tenant×provider) 행의 sync_started_at을 **원자 UPDATE**로 선점.
 * 창=iframe 멀티윈도우·복수 master의 동시 실행을 서버에서 직렬화한다(클라 disabled는 한 창만 커버,
 * 2026-07-13 전수조사). 시트 셀 데이터는 drive.files.update 통째 교체라 원자적이지만, 후속
 * CLIP 서식·수식 batchUpdate가 동시 재교체와 겹치면 stale sheetId 400(허위 실패 토스트)이 나므로
 * 애초에 한 번에 하나만 실행되게 한다. makeedu 공유 락(getMakeeduSyncLock)과 같은 DB 파생 락 계열.
 *
 * 반환: "claimed"=선점 성공 / "busy"=다른 실행 진행 중(3분 이내) / "norow"=연동 행 없음
 * (파일 업로드 가져오기 등 시트 미연동 경로 — 보호할 시트가 없으니 호출부는 그냥 진행).
 */
export async function claimSheetSyncLease(supabase: Supa, provider: string): Promise<SheetSyncLease> {
  const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();
  const { data } = await supabase
    .from("user_integrations")
    .update({ sync_started_at: new Date().toISOString() })
    .eq("provider", provider)
    .or(`sync_started_at.is.null,sync_started_at.lt.${staleIso}`)
    .select("provider");
  if ((data ?? []).length > 0) return "claimed";
  // 선점 실패 — 행이 있으면 진행 중(busy), 없으면 시트 미연동(norow).
  const { data: row } = await supabase
    .from("user_integrations")
    .select("provider")
    .eq("provider", provider)
    .maybeSingle();
  return row ? "busy" : "norow";
}

/** 리스 해제 — 이 쓰기가 실패해도 3분 stale로 자가 회복하므로 best-effort면 충분. */
export async function releaseSheetSyncLease(supabase: Supa, provider: string): Promise<void> {
  await supabase.from("user_integrations").update({ sync_started_at: null }).eq("provider", provider);
}
