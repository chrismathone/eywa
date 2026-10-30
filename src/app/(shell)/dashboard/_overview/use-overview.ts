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
 * 자동 갱신 주기 — 30초 → 5분(원장 2026-10-30 *"30초 갱신 -> 5분 갱신으로 변경. 수동갱신은 여전히 그때그때 가능하게. 메모리 확보용"*).
 * 오른쪽 [새로 고침]은 그대로 언제든 바로 읽는다.
 */
export const OVERVIEW_REFRESH_MS = 5 * 60_000;
/** 이 안에 읽은 값은 창 복귀·포커스로 다시 읽지 않는다(오가기만 해도 매번 읽으면 5분 주기가 무색하다). */
const FRESH_MS = 60_000;

/**
 * 운영실 스냅샷 + 5분 갱신·실시간 구독. `live: false` = 학원 설정 '대시보드 관리' 미리보기 — 받은 스냅샷을 그대로 두고
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
    staleTime: FRESH_MS,
    refetchInterval: OVERVIEW_REFRESH_MS,
    refetchIntervalInBackground: false,
    // 포커스 복귀는 1분이 지난 값만 다시 읽는다("always"는 창을 오갈 때마다 읽었다 — 메모리 확보, 원장 2026-10-30).
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    retry: 1,
  });
  // 🔴 표마다 걸던 DB 변경 구독(postgres_changes · 탭 하나에 최대 24개)을 뗐다 — 원장 2026-10-29 DB 메모리 부족 정지(19:02~19:10)
  //    조사에서 실시간 변경 확인 질의가 DB 시간을 가장 많이 썼다. 바닥은 위의 5분 갱신이고, 같은 브라우저의 저장 신호는
  //    바로 새로 읽는다(화면 복귀는 1분 지난 값만). 다른 사람의 변경은 5분 안에 — 급하면 [새로 고침].
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
      if (document.visibilityState !== "visible") return;
      const at = client.getQueryState(["dashboard-overview", initial.scope])?.dataUpdatedAt ?? 0;
      if (Date.now() - at >= FRESH_MS) refresh();
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
