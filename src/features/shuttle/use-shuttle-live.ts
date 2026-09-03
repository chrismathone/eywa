"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  isLivePayload,
  newSenderId,
  shouldReactTo,
  shuttleLiveChannel,
  SHUTTLE_LIVE_EVENT,
  type ShuttleLiveKind,
} from "./live-channel";

/**
 * 셔틀 **실시간 반영** 훅 — 같은 날짜를 보고 있는 화면끼리 서로를 깨운다.
 *
 * 원장(2026-09-02): 동승 선생님이 폰에서 찍은 것을 데스크·원장이 **바로** 봐야 한다. 종전엔 각자
 * 누른 것만 `router.refresh()`로 갱신돼, 남이 찍은 건 새로고침해야 보였다.
 *
 * 쓰는 법 — 찍는 화면은 액션 성공 뒤에 `publish("boarding")`, 보는 화면은 그냥 걸어만 두면 된다:
 *   const { publish, lastSignalAt } = useShuttleLive({ tenantId, date });
 *
 * 🔴 **보낸 쪽은 자기 신호로 새로고침하지 않는다** — 액션 직후 이미 refresh를 했으므로, 또 하면 한 번
 *    누를 때마다 왕복이 두 번이고 빠르게 연달아 찍는 현장에서 화면이 계속 깜빡인다(`self:false` +
 *    sender 대조로 이중 방어: 설정 하나에만 기대면 클라이언트 버전이 바뀔 때 조용히 새어 들어온다).
 * 🔴 **몰아서 한 번만 새로고침한다**(`COALESCE_MS`) — 회차 하나를 훑으며 12명을 연속으로 찍으면
 *    신호가 12번 온다. 그때마다 서버 왕복을 돌면 보는 쪽 화면이 그동안 계속 스켈레톤 근처에서 논다.
 * ⚠️ **실패는 조용히 접는다** — 실시간이 안 붙어도 화면은 종전대로 돌아야 한다(내가 누른 것은 여전히
 *    refresh된다). 여기서 throw하면 그 화면이 통째로 죽는다.
 * ⚠️ presence(`edit-presence`)와 **다른 채널**이다 — 그쪽은 "누가 편집 중"이고 이건 "무언가 바뀜"이다.
 *    한 채널에 얹으면 셔틀을 안 쓰는 화면까지 이 신호를 받는다.
 */

/** 신호가 몰아쳐도 새로고침은 이 간격으로 한 번. 사람이 "바로"라고 느끼는 하한 근처. */
const COALESCE_MS = 400;

export type ShuttleLive = {
  /** 내가 뭔가 바꿨다고 알린다 — 액션이 **성공한 뒤에만** 부를 것(실패한 것을 알리면 남의 화면만 헛돈다). */
  publish: (kind: ShuttleLiveKind) => void;
  /** 남이 바꿔서 갱신된 마지막 시각(ms) — 없으면 null. 관제 화면이 "방금 갱신됨"에 쓴다. */
  lastSignalAt: number | null;
};

export function useShuttleLive({
  tenantId,
  date,
  enabled = true,
}: {
  tenantId: string;
  date: string;
  /** 실시간이 의미 없는 화면(지난 날짜 열람 등)에서 끈다 — WebSocket을 아예 안 연다. */
  enabled?: boolean;
}): ShuttleLive {
  const router = useRouter();
  const [lastSignalAt, setLastSignalAt] = useState<number | null>(null);

  // 탭 식별자는 mount 1회 — 사람이 아니라 **화면**을 가른다(한 사람이 폰·PC를 같이 열 수 있다).
  const [senderId] = useState(() => newSenderId());

  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const subscribedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId || !date) return;

    let disposed = false;
    const supabase = createClient();
    const channel = supabase.channel(shuttleLiveChannel(tenantId, date), {
      // self:false = 내 신호는 나에게 안 돌아온다. 아래 sender 대조가 이중 방어.
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: SHUTTLE_LIVE_EVENT }, (message) => {
      const p = (message as { payload?: unknown }).payload;
      if (!isLivePayload(p) || !shouldReactTo(p, senderId)) return;
      setLastSignalAt(p.at);
      // 몰아치는 신호를 한 번으로 — 마지막 신호 뒤 COALESCE_MS에 한 번만 왕복한다.
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (!disposed) router.refresh();
      }, COALESCE_MS);
    });

    channel.subscribe((status) => {
      subscribedRef.current = status === "SUBSCRIBED";
    });

    return () => {
      disposed = true;
      subscribedRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [tenantId, date, enabled, senderId, router]);

  const publish = useCallback(
    (kind: ShuttleLiveKind) => {
      const channel = channelRef.current;
      // 아직 안 붙었으면 그냥 넘어간다 — 내 화면은 이미 갱신됐고, 남의 화면은 다음 신호나 새로고침에
      // 따라온다. 여기서 재시도 큐를 만들면 실패가 쌓여 있다가 한꺼번에 터진다.
      if (!channel || !subscribedRef.current) return;
      void channel
        .send({
          type: "broadcast",
          event: SHUTTLE_LIVE_EVENT,
          payload: { sender: senderId, kind, at: Date.now() },
        })
        // 🔴 조용히 접는다 — 알림이 안 간 것뿐이고 내 저장은 이미 끝났다. 여기서 에러를 띄우면
        //    성공한 기록에 대고 "실패했다"고 말하는 꼴이 된다.
        .catch(() => {});
    },
    [senderId],
  );

  return { publish, lastSignalAt };
}
