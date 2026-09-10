"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { refreshOverview } from "@/features/dashboard/overview/actions";
import {
  mergeSnapshot,
  type OverviewSnapshot,
} from "@/features/dashboard/overview/model";
import {
  overviewTables,
  refreshDelay,
} from "@/features/dashboard/overview/realtime";
import { subscribeRecordSaved } from "@/lib/realtime/record-channel";

export function useOverview(initial: OverviewSnapshot) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["dashboard-overview", initial.scope],
    queryFn: async () => {
      const next = await refreshOverview();
      return mergeSnapshot(
        client.getQueryData<OverviewSnapshot>([
          "dashboard-overview",
          initial.scope,
        ]),
        next,
      );
    },
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
  }, [client, initial.scope, initial.tenantId, tablesKey]);
  return query;
}
