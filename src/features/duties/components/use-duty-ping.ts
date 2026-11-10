"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { DUTY_PING_EVENT, dutyPingChannel } from "../live-ping";

/**
 * 출결 · 보고서 · 상담이 저장되는 순간 `onChange`를 부른다(원장 2026-11-10 *"굳이 기간마다 반영할 필요가 있나?"*) — 지점 채널의 신호를 듣는다.
 * 신호는 "바뀌었다"뿐이라 화면은 평소의 GET으로 다시 받는다(그 길이 읽기 전 맞춤을 지난다). 실시간 연결이 안 돼도 화면의 주기 갱신이 그대로 받친다.
 * 🔴 신호마다 곧장 받지 않는다 — 수업 시간엔 저장이 초 단위로 이어지고 지점의 열린 화면 전부가 같은 신호를 받는다(B6):
 *   · 첫 신호는 짧은 무작위 지연 뒤 한 번(화면들이 같은 순간에 몰리지 않게) · 그 뒤 `minGapMs` 안의 신호는 그 끝에 한 번으로 모은다(마지막 신호는 반드시 반영된다).
 *   · 장부를 맞춘 쪽이 끝나면 같은 신호가 한 번 더 온다(s2_0054 `duty_sync_finish`) — 맞춤 잠금에 져서 옛 값을 받은 화면도 그때 새 값을 받는다.
 * 숨은 탭에서는 받지 않는다(보이게 되면 화면이 스스로 한 번 받는다).
 */
export function useDutyPing(tenantId: string | null | undefined, onChange: () => void, minGapMs = 5000) {
  const handler = useRef(onChange);
  useEffect(() => { handler.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!tenantId) return;
    let timer: number | null = null;
    let lastRun = 0;
    const supabase = createClient();
    const channel = supabase.channel(dutyPingChannel(tenantId));
    channel.on("broadcast", { event: DUTY_PING_EVENT }, () => {
      if (document.visibilityState !== "visible" || timer !== null) return; // 이미 예약돼 있으면 그 한 번이 이 신호까지 반영한다
      const wait = Math.max(lastRun + minGapMs - Date.now(), 400 + Math.random() * 600);
      timer = window.setTimeout(() => { timer = null; lastRun = Date.now(); handler.current(); }, wait);
    });
    channel.subscribe();
    return () => { if (timer !== null) window.clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [tenantId, minGapMs]);
}
