"use client";
import { useEffect, useState } from "react";
import { readContributionRecent } from "../server/recent-action";
import type { ChangePeriod } from "../model/list-controls";
import type { getContributionList } from "../server/queries";

type Data = NonNullable<Awaited<ReturnType<typeof getContributionList>>>;
type Result = Awaited<ReturnType<typeof readContributionRecent>>;
export function useRecentContribution(data: Data, period: ChangePeriod) {
  const [cache, setCache] = useState<Record<string, Result>>({}), [retry, setRetry] = useState(0);
  const key = JSON.stringify([data.gate.tenantId, data.gate.userId, data.month, data.refreshedAt, data.revision, data.rows.map((r) => r.id), period, retry]);
  const result = cache[key];
  useEffect(() => {
    if (period === 12 || result || !data.ready) return;
    let active = true;
    readContributionRecent({ period, month: data.month, refreshedAt: data.refreshedAt, revision: data.revision })
      .catch(() => ({ error: "기간별 변화를 불러오지 못했습니다. 다시 시도해 주세요." }))
      .then((next) => { if (active) setCache((current) => ({ ...current, [key]: next })); });
    return () => { active = false; };
  }, [key, result, period, data.ready, data.month, data.refreshedAt, data.revision]);
  const rows = period === 12 ? data.rows.flatMap((r) => r.total ? [{ studentId: r.id, recent: r.total.recent }] : []) : result?.rows ?? [];
  return { byStudent: new Map(rows.map((r) => [r.studentId, r.recent])), loading: period !== 12 && data.ready && !result,
    error: period !== 12 ? result?.error : undefined, refreshRequired: period !== 12 && result?.code === "stale", retry: () => setRetry((v) => v + 1) };
}
