"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { regenerateDailyBriefing } from "@/features/dashboard/server/actions";

/**
 * 일일 브리핑 '다시 생성' 버튼 + 생성 중 폴링 워처.
 * - daily_briefings엔 select RLS 정책이 없어(0114a 의도) Realtime 구독이 불가 — 5초 폴링만.
 *   폴링은 analyzing일 때만 마운트돼 평상시 대시보드에 상시 폴링을 얹지 않는다.
 * - 성공 부수효과 없음(#67 회피): 완료 반영은 폴링(router.refresh)이 담당, 버튼은 시작만.
 */
export function DailyBriefingRegen({ analyzing }: { analyzing: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!analyzing) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [analyzing, router]);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || analyzing}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await regenerateDailyBriefing();
            if (result?.error) setError(result.error);
            router.refresh();
          });
        }}
      >
        {pending || analyzing ? "생성 중…" : "다시 생성"}
      </Button>
      {error ? <p className="text-danger max-w-56 text-right text-[11px] leading-snug">{error}</p> : null}
    </div>
  );
}
