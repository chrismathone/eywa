import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

// makeedu → eywa 동기화 도메인(0058a makeedu_sync_state.domain).
export type MakeeduSyncDomain =
  | "students"
  | "classes"
  | "enrollments"
  | "invoices"
  | "consultations"
  | "prospects"
  | "catalog";

export type MakeeduSyncState = {
  syncedAt: string;
  rowCount: number | null;
  status: string;
};

/**
 * 도메인별 마지막 동기화 상태. RLS(tenant_isolation)로 현재 테넌트 행만 조회 → tenant 필터 불요.
 * 동기화를 한 번도 안 한 도메인/테넌트는 null(배지 미표시).
 */
export const getMakeeduSyncState = cache(
  async (domain: MakeeduSyncDomain): Promise<MakeeduSyncState | null> => {
    const user = await getCurrentUser();
    if (!user) return null;
    const supabase = await createClient();
    const { data } = await supabase
      .from("makeedu_sync_state")
      .select("synced_at, row_count, status")
      .eq("domain", domain)
      .maybeSingle();
    if (!data) return null;
    return { syncedAt: data.synced_at as string, rowCount: data.row_count as number | null, status: data.status as string };
  },
);

export type MakeeduAutoSyncStatus = {
  /** GitHub Actions cron 자동 동기화 ON/OFF. 행이 없으면 기본 ON(cron opt-out 모델 — 끄면 cron이 스킵). */
  enabled: boolean;
  /** 도메인 통틀어 가장 최근 동기화 시각(배지 요약). */
  lastSyncedAt: string | null;
};

/** makeedu 자동 동기화 토글 상태 + 최근 동기화 시각. 연동 면(MakeeduSyncCard)에서 사용. */
export async function getMakeeduAutoSyncStatus(): Promise<MakeeduAutoSyncStatus> {
  const user = await getCurrentUser();
  if (!user) return { enabled: true, lastSyncedAt: null };
  const supabase = await createClient();
  // 독립 조회 둘 → 병렬(B4). RLS(tenant_isolation)로 현재 테넌트 행만.
  const [{ data: integ }, { data: latest }] = await Promise.all([
    supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu").maybeSingle(),
    supabase
      .from("makeedu_sync_state")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    enabled: integ?.sync_enabled !== false, // 행 없으면 기본 ON
    lastSyncedAt: (latest?.synced_at as string | undefined) ?? null,
  };
}
