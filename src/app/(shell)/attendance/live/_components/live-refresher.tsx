"use client";

/**
 * 오늘 출결 자동 갱신 — 20초마다 **기록 건수만** 확인하고, 바뀌었을 때만 화면을 다시 그린다.
 *
 * ⚠️ Realtime(postgres_changes)을 쓰지 않는 이유: 이 프로젝트에서 그 채널은 SUBSCRIBED까지 가지만
 *    RLS 인가가 막아 **이벤트가 조용히 안 온다**(등록상담 워처가 같은 이유로 폴링이다). "실시간인 줄
 *    알았는데 아무 것도 안 오는" 화면이 가장 나쁘다 — 데스크가 큐를 믿고 안 보게 된다.
 * ⚠️ 탭이 백그라운드면 쉰다 — 안 보는 화면 때문에 서버를 두드릴 이유가 없다(창이 여러 개 뜨는 앱).
 * ⚠️ 강사가 방금 누른 저장도 `router.refresh()`를 부르므로, 이 폴링은 **남이 찍은 것**을 데려오는 몫이다.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "@/components/icons/eywa-icon-compat";
import { getLiveRecordedCount } from "@/features/attendance/live/server/poll-actions";

const POLL_MS = 20_000;

export function LiveRefresher({ date }: { date: string }) {
  const router = useRouter();
  const [changed, setChanged] = useState(false);
  /**
   * 기준선은 **첫 폴 결과**로 잡는다(서버 렌더 수치를 쓰지 않는다).
   * ⚠️ 서버가 그린 숫자는 강사면 "내 수업만"이고 이 카운트는 테넌트 전체라, 그 둘을 비교하면 강사
   *    화면에서 20초마다 무한 새로고침이 돈다. 같은 자로 잰 값끼리만 비교한다.
   */
  const baselineRef = useRef<string | null>(null);

  useEffect(() => {
    baselineRef.current = null; // 날짜가 바뀌면 기준선도 새로
  }, [date]);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const fingerprint = await getLiveRecordedCount(date).catch(() => null);
      if (stopped || fingerprint == null) return;
      if (baselineRef.current == null) {
        baselineRef.current = fingerprint;
        return;
      }
      if (fingerprint !== baselineRef.current) {
        baselineRef.current = fingerprint;
        setChanged(true);
        router.refresh();
      }
    };
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, date]);

  if (!changed) return null;
  // 화면이 스스로 바뀌면 사람은 "내가 뭘 잘못 눌렀나" 한다 → 무슨 일이 있었는지 한 줄로 알린다.
  return (
    <p className="text-text-faint inline-flex items-center gap-1.5 text-xs">
      <RefreshCw className="size-3" />
      새 출결 입력이 있어 화면을 갱신했습니다
    </p>
  );
}
