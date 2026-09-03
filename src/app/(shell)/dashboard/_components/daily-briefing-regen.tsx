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
    // 폴링 상한 3분(36틱) — 정상 생성(<60s)보다 훨씬 길게 두되, after()가 죽어 analyzing으로
    // 고착된 날 하루 종일 5초마다 대시보드 전체 RSC를 재실행하는 과호출을 끊는다(적대 리뷰 확정).
    let ticks = 0;
    const timer = window.setInterval(() => {
      ticks += 1;
      if (ticks > 36) {
        window.clearInterval(timer);
        return;
      }
      router.refresh();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [analyzing, router]);

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        // analyzing이어도 클릭 가능해야 서버의 'updated_at 5분 stuck 우회'가 실행된다(잠그면 도달
        // 불가능한 죽은 코드 — 고착 시 그날 복구 경로가 없었다). 진행 중 클릭은 서버가
        // "이미 생성이 진행 중입니다"로 안전하게 거절한다.
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await regenerateDailyBriefing();
            if (result?.error) setError(result.error);
            router.refresh();
          });
        }}
      >
        {pending ? "생성 중…" : analyzing ? "다시 시도" : "다시 생성"}
      </Button>
      {error ? <p className="text-danger max-w-56 text-right text-xs leading-snug">{error}</p> : null}
    </div>
  );
}
