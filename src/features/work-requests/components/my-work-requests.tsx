"use client";

import { useEffect, useState } from "react";
import "@/app/(shell)/dashboard/_instruments/instruments.css";
import { WorkProvider, useWork } from "@/app/(shell)/dashboard/_instruments/work/work-context";
import { ReceivedList } from "@/app/(shell)/dashboard/_instruments/work/received-list";
import { EyIcon } from "@/components/icons/aywa-icons";
import { receivedBy, receivedCounts, urgentFirst } from "../model";

/** 받은 요청이 있으면 1분 · 없으면 5분마다(전 강사가 하루 종일 띄워 두는 화면이다 — 받은 것이 없는 선생님까지 매분 묻지 않는다). */
export const refreshMsOf = (received: number) => (received ? 60_000 : 300_000);

/**
 * 강사 홈(원스크린 · 영어 시트) '받은 업무 요청' 한 줄 — 내가 담당자로 받은 업무 요청(관리자 '처리 요청' · 운영실 업무 요청).
 * 업무 요청은 벨에 잇지 않는다(dashboard.md) — 대신 강사가 매일 여는 홈에 입구를 둔다. 받은 것이 하나라도 있을 때만 선다.
 * 숫자는 보일 때 주기적으로(`refreshMsOf`) · 다시 보일 때 바로 새로 받는다(새로고침 없이 새 요청이 뜬다). 상세 · 확인 · 처리 보고는 운영실과 같은 창(`WorkDrawer`).
 */
export function MyWorkRequests({ today, className = "" }: { today: string; className?: string }) {
  return <WorkProvider today={today} tick={0} raised><Strip className={className} /></WorkProvider>;
}

function Strip({ className }: { className: string }) {
  const { board, failed, today, open, refresh } = useWork();
  const [listing, setListing] = useState(false);
  const c = receivedCounts(board.items, board.me);
  // 꺼진 지점 · 지점 보기(서버가 '없음'으로 답함)는 다시 묻지 않는다 — 첫 조회가 실패했을 때만 계속 묻는다.
  //   숨긴 창은 셸이 창 문서의 visibilityState를 '숨김'으로 덮는다(frame-visibility.ts) — 아래 판정 그대로 멈춘다.
  const live = board.enabled || failed;
  useEffect(() => {
    if (!live) return;
    const bump = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(bump, refreshMsOf(c.total));
    document.addEventListener("visibilitychange", bump);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", bump); };
  }, [live, refresh, c.total]);
  // 받은 것이 없으면 줄을 세우지 않는다(실패도 '0건'으로 그리지 않는다 — 다음 갱신에 다시 묻는다).
  if (!board.enabled || !c.total) return null;
  const label = c.open ? `받은 업무 요청 — 내 차례 ${c.turn} · 진행 중 ${c.open}` : "받은 업무 요청 — 진행 중 없음";
  return <section className={`border-line bg-card rounded-2xl border ${className}`}>
    <button type="button" onClick={() => setListing(true)} className="hover:bg-bg-soft flex w-full flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-left">
      <EyIcon name="send" size={15} className={`shrink-0 ${c.turn ? "text-danger" : "text-foreground"}`} />
      <span className={`min-w-0 flex-1 text-sm font-bold ${c.turn ? "text-danger" : "text-foreground"}`}>{label}</span>
      {failed ? <span className="text-text-dim text-xs">새로 받지 못함</span> : null}
      <span className="text-text-dim text-xs font-medium">열기 ›</span>
    </button>
    {listing ? <ReceivedList items={urgentFirst(receivedBy(board.items, board.me), board.me, today)} me={board.me} today={today} onClose={() => setListing(false)} onOpen={(id) => { setListing(false); open(id); }} /> : null}
  </section>;
}
