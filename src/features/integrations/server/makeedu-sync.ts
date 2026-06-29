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
