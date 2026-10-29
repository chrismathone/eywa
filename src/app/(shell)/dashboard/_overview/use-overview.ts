"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refreshOverview, refreshSubjectOverview } from "@/features/dashboard/overview/actions";
import {
  mergeSnapshot,
  type OverviewSnapshot,
} from "@/features/dashboard/overview/model";
import { refreshDelay } from "@/features/dashboard/overview/realtime";
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
  // 🔴 표마다 걸던 DB 변경 구독(postgres_changes · 탭 하나에 최대 24개)을 뗐다 — 원장 2026-10-29 DB 메모리 부족 정지(19:02~19:10)
  //    조사에서 실시간 변경 확인 질의가 DB 시간을 가장 많이 썼다. 바닥은 위의 30초 갱신이고, 같은 브라우저의 저장 신호와
  //    화면 복귀가 바로 새로 읽는다. 다른 사람의 변경은 30초 안에 보인다.
  useEffect(() => {
    if (!live) return;
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
    };
  }, [client, initial.scope, live]);
  return query;
}
