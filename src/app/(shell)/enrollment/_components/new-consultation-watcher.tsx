"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "@/components/icons/aywa-icon-compat";
import { getConsultationTotalCount } from "@/features/enrollment/server/poll-actions";

/**
 * 등록상담 목록 자동 갱신 — 학부모가 QR 접수를 제출하면 **새로고침 없이** 목록에 새 상담이 뜬다.
 *
 * 방식: 20초마다 **총건수만**(count head, 행 미수신) 확인하고, 서버 렌더 시점보다 늘었을 때만
 * `router.refresh()`로 무거운 칸반 쿼리를 다시 돌린다. 평상시 비용은 인덱스 카운트 1회뿐이라
 * 창마다 도는 폴링이어도 반응속도 규칙(B6)을 건드리지 않는다.
 *
 * ⚠️ Realtime(postgres_changes)은 이 테이블에서 **조용히 무전송**이다 — 채널은 SUBSCRIBED까지 가지만
 *    RLS 인가가 막아 이벤트가 안 온다(근거는 `server/poll-actions.ts` 주석). 그래서 폴링이다.
 * ⚠️ 탭이 백그라운드면 폴링을 쉰다 — 안 보는 화면 때문에 서버를 두드릴 이유가 없다.
 */
const POLL_MS = 20_000;

export function NewConsultationWatcher({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const [arrived, setArrived] = useState(0);
  // 서버 렌더 시점의 건수를 기준선으로 들고 간다(refresh로 prop이 바뀌어도 기준은 내가 갱신).
  const baselineRef = useRef(initialCount);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const count = await getConsultationTotalCount();
      if (stopped || count == null) return;
      if (count > baselineRef.current) {
        const added = count - baselineRef.current;
        baselineRef.current = count;
        setArrived((n) => n + added);
        router.refresh();
      } else if (count < baselineRef.current) {
        // 삭제 등으로 줄면 기준만 맞춘다(줄어든 걸 "새 접수"로 세지 않는다).
        baselineRef.current = count;
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    // 다른 탭을 보다 돌아온 순간은 바로 확인(가장 흔한 "왜 안 떠?" 지점).
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (arrived === 0) return null;

  // 화면이 스스로 바뀌면 사람은 "내가 뭘 잘못 눌렀나" 한다 → 무슨 일이 있었는지 한 줄로 알린다.
  return (
    <p className="text-primary inline-flex items-center gap-1.5 text-xs">
      <RefreshCw className="size-3" />새 접수 <span className="num">{arrived}</span>건이 도착해 목록을 갱신했습니다
    </p>
  );
}
