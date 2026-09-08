"use client";

// 발송 시간창 안내 — **지금이 시간대 밖일 때만** 표시(원장 지시 2026-07-29, KST 기준).
// 시간대 안에서는 발송이 그냥 나가므로 상시 안내는 노이즈였다. 판정은 워커 미러 순수함수
// classnoteSendWindowHint(창 안·무제한=null)를 그대로 쓰고, 원스크린은 하루 종일 켜두는 화면이라
// 서버 시점 고정이 아니라 **분 단위로 재판정**한다(8시에 연 화면이 9시에도 배너를 보이면 거짓말).
// useSyncExternalStore: SSR/하이드레이션 스냅샷은 null(미표시) → 마운트 후 실제 KST로 갱신 —
// 서버·클라 시계 차이로 인한 hydration 불일치가 원천적으로 없다(#25 setState-in-effect도 회피).
import { useSyncExternalStore } from "react";
import { classnoteSendWindowHint } from "../classnote-guard";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

const TICK_MS = 30_000;

function subscribe(onChange: () => void): () => void {
  const id = window.setInterval(onChange, TICK_MS);
  return () => window.clearInterval(id);
}

export function SendWindowNotice({ start, end }: { start: string; end: string }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const hint = useSyncExternalStore(
    subscribe,
    () => classnoteSendWindowHint(start, end),
    () => null,
  );
  if (!hint) return null;
  return (
    <div className="border-line bg-bg-soft text-text-dim rounded-md border px-3 py-2 text-xs">
      {/* "수업 보고서" 한정 표기 — 반 공지는 시간창 미적용(G1 확정)이라 ClassNote 전체로 말하면 과약속. */}
      <span className="text-foreground font-bold">{tf("os.sw.title", { hint })}</span>
      <span>{t("os.sw.body")}</span>
    </div>
  );
}
