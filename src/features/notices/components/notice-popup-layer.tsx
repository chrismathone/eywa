"use client";

import { useSyncExternalStore } from "react";
import { useNoticeDismiss, isHidden } from "../popup-store";
import type { ActivePopup } from "../server/queries";
import { NoticePopupCard } from "./notice-popup-card";

// 하이드레이션 게이트 — SSR=false/클라=true. 서버는 항상 null(팝업 SSR 안 됨) → dismiss 필터 미스매치 없음(#25).
const subscribeNoop = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribeNoop, () => true, () => false);

// position → 화면 앵커(그리드 블록 위치 + 내부 정렬). cascade는 중앙 그리드로 흡수.
const ANCHOR: Record<string, { outer: string; inner: string }> = {
  center: { outer: "items-center justify-center", inner: "justify-center" },
  cascade: { outer: "items-center justify-center", inner: "justify-center" },
  "left-top": { outer: "items-start justify-start", inner: "justify-start" },
  "right-top": { outer: "items-start justify-end", inner: "justify-end" },
  "left-bottom": { outer: "items-end justify-start", inner: "justify-start" },
  "right-bottom": { outer: "items-end justify-end", inner: "justify-end" },
};
const anchorOf = (p: string) => ANCHOR[p] ?? ANCHOR.center;

/**
 * 공지 팝업 레이어 — 셸 진입 시 활성 팝업을 그리드로 타일링(겹치지 않음). position 앵커별로 그룹을 만들고,
 * 같은 앵커의 팝업은 flex-wrap으로 나란히 배치(여러 개여도 안 겹침). fixed 레이어는 pointer-events-none,
 * 카드만 auto → 카드 사이 빈 공간은 아래 페이지로 클릭 통과. 임베드 iframe엔 마운트 안 함(부모 셸만).
 */
export function NoticePopupLayer({ popups }: { popups: ActivePopup[] }) {
  const hydrated = useHydrated();
  const dismissed = useNoticeDismiss((s) => s.dismissed);

  if (!hydrated || popups.length === 0) return null;
  const visible = popups.filter((p) => !isHidden(dismissed[p.id], p.updatedAt));
  if (visible.length === 0) return null;

  // 앵커별 그룹화(같은 앵커 = 한 그리드 클러스터).
  const groups = new Map<string, ActivePopup[]>();
  for (const p of visible) {
    const a = p.position in ANCHOR ? p.position : "center";
    (groups.get(a) ?? groups.set(a, []).get(a)!).push(p);
  }

  return (
    <>
      {[...groups.entries()].map(([pos, items]) => {
        const a = anchorOf(pos);
        return (
          // print:hidden — 팝업 뜬 채 문서 인쇄 시 카드가 인쇄물 위에 찍히는 것 방지.
          <div key={pos} className={`pointer-events-none fixed inset-0 z-[55] flex p-4 print:hidden ${a.outer}`}>
            <div className={`flex max-w-full flex-wrap content-start gap-4 ${a.inner}`}>
              {items.map((p) => (
                <NoticePopupCard key={p.id} popup={p} />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}
