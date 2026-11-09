"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshScheduleState, remainingTime } from "../model/refresh-schedule";

export function AggregationStatus({ cron, checkedAt, refreshedAt, missing, busy }: {
  cron: string | null; checkedAt: string; refreshedAt: string | null; missing: number; busy: boolean;
}) {
  const [now, setNow] = useState(() => Date.parse(checkedAt));
  const router = useRouter(), [refreshing, start] = useTransition();
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const schedule = refreshScheduleState(cron, now, refreshedAt, Date.parse(checkedAt));
  return <section className="space-y-1 text-xs leading-relaxed" aria-label="로열티 집계 일정">
    <p>최근 집계 {refreshedAt ? new Date(refreshedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "집계 전"}</p>
    <p className="font-medium text-primary">{busy ? "로열티·재원기간을 함께 집계하고 있습니다." : schedule
      ? `다음 자동 집계 약 ${remainingTime(schedule.next - now)} · 매일 ${schedule.time} (한국 시간)` : "자동 집계 일정을 확인할 수 없습니다."}</p>
    {!busy && (schedule?.status === "running" || schedule?.status === "outdated") && <p>새 집계 결과가 있을 수 있습니다. 새로고침해 확인하세요.</p>}
    {!busy && schedule?.status === "unconfirmed" && <p className="text-amber">직전 자동 집계의 완료가 확인되지 않았습니다. 최근 집계 시각을 확인해 주세요.</p>}
    {!busy && schedule && schedule.status !== "scheduled" && <button type="button" disabled={refreshing} onClick={() => start(() => router.refresh())} className="text-primary underline underline-offset-4">{refreshing ? "확인 중…" : "집계 결과 새로고침"}</button>}
    {missing > 0 && <p>재원기간 미집계 {missing}명 · 로열티와 같은 집계에서 함께 갱신됩니다.</p>}
  </section>;
}
