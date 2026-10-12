"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { refreshOverview, refreshSubjectOverview } from "@/features/dashboard/overview/actions";
import {
  mergeSnapshot,
  type OverviewSnapshot,
} from "@/features/dashboard/overview/model";
import {
  overviewTables,
  refreshDelay,
} from "@/features/dashboard/overview/realtime";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";

/**
 * 운영실 스냅샷 + 30초 갱신·실시간 구독. `live: false` = 학원 설정 '대시보드 관리' 미리보기 — 받은 스냅샷을 그대로 두고
 * 조회·구독을 하지 않는다(미리보기 원본은 원장 시점이라 갱신하면 역할 미리보기가 원장 화면으로 덮인다).
 */
export function useOverview(initial: OverviewSnapshot, { live = true }: { live?: boolean } = {}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboard-overview", initial.scope],
    queryFn: async () => {
      const next = initial.view?.activeSubject ? await refreshSubjectOverview(initial.view.activeSubject) : await refreshOverview();
      return mergeSnapshot(
        client.getQueryData<OverviewSnapshot>([
          "dashboard-overview",
          initial.scope,
        ]),
        next,
      );
    },
    enabled: live,
    initialData: initial,
    initialDataUpdatedAt: initial.requestedAt,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: 1,
  });
  const tablesKey = overviewTables(query.data.allowed).join(",");

  useEffect(() => {
    if (!live) return;
    const db = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstSignal = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      if (!firstSignal) firstSignal = Date.now();
      clearTimeout(timer);
      timer = setTimeout(
        () => {
          firstSignal = 0;
          // Do not cancel an in-flight snapshot; invalidation remains deduplicated by TanStack Query.
          void client.invalidateQueries(
            { queryKey: ["dashboard-overview", initial.scope] },
            { cancelRefetch: false },
          );
        },
        refreshDelay(firstSignal, Date.now()),
      );
    };
    // Optional tables can be missing during a rolling migration. Isolate subscriptions so one
    // unavailable table cannot disconnect attendance, payments and the other sources.
    const channels = tablesKey
      .split(",")
      .filter(Boolean)
      .map((table) =>
        db
          .channel(`overview:${initial.scope}:${table}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table,
              filter: `tenant_id=eq.${initial.tenantId}`,
            },
            refresh,
          )
          .subscribe(),
      );
    // Cross-window writes can request a refresh without passing any record payload.
    const unsubscribeSaved = subscribeRecordSaved(refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      unsubscribeSaved();
      for (const channel of channels) void db.removeChannel(channel);
    };
  }, [client, initial.scope, initial.tenantId, tablesKey, live]);
  return query;
}
