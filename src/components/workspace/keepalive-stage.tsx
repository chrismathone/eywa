"use client";

import { useEffect } from "react";
import { useWindowStore, type Win } from "./window-store";
import { WindowContent } from "./window-content";
import { KeepaliveMaximizeSync } from "@/components/page-maximize/keepalive-page-maximize";

/**
 * 단일 화면(이전 화면 유지) 방식의 **화면 무대** — 창 엔진의 창을 **크롬 없이 화면 가득** 그린다(테두리·제목줄·최소화 버튼 없음).
 * 보이는 화면은 하나(스토어 `applyKeepalive`가 보장), 나머지는 닫지 않고 **보이지 않게** 둔다.
 *
 * 🔴 숨김은 `display:none`이 아니라 `visibility:hidden`이다([[#131]]) — 레이아웃을 살려 문서·스크롤·입력을 그대로 두고, 이미 열린
 *    화면이 폰트·레이아웃을 잃지 않는다. 한 번도 안 연 화면(영속 복원)은 iframe src가 없어 비용 0이다(`RouteWindow`의 activated 규칙 —
 *    최소화된 창은 활성화하지 않는다). 숨은 문서에는 `frame-visibility`가 '안 보임'을 알려 폴링이 멈추고, 다시 보일 때 10분 넘게 숨었으면
 *    소프트 새로고침(`use-window-signals` ③)이 돈다 — 화면은 그대로, 데이터만.
 * 🔴 창 바닥은 **뷰포트 전체**(왼쪽 사이드바 밑까지)다 — 사이드바(z-45)가 그 위를 덮는다. 문서 폭이 곧 뷰포트 폭이라 폭 기준 반응형(머리글 한 줄·
 *    `desk:` 배치)이 단일 화면과 똑같이 판정된다(사이드바 폭만큼 좁은 폭으로 재면 노트북에서 머리글이 창용 한 줄로 접힌다).
 *    사이드바 폭만큼 안쪽 여백은 창 문서가 부모 사이드바를 보고 스스로 만든다(`keepalive-frame-bridge.tsx`).
 */
export function KeepaliveStage() {
  const windows = useWindowStore((s) => s.windows);
  // 첫 로딩 스켈레톤(RouteWindow)이 사이드바 밑에 깔리지 않게 폭을 변수로 싣는다 — 창 모드의 창은 이 변수가 없어(0) 종전 그대로다.
  useEffect(() => {
    const aside = document.querySelector<HTMLElement>("[data-shell-sidebar]");
    if (!aside) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--keepalive-rail-parent", `${Math.round(aside.getBoundingClientRect().width)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(aside);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--keepalive-rail-parent");
    };
  }, []);
  return (
    <>
      {/* 셸의 '화면 최대화' ↔ 화면(iframe)의 머리글 버튼·표식 — 이 방식에서만 산다. */}
      <KeepaliveMaximizeSync />
      {Object.values(windows).map((w) => (
        <KeepaliveFrame key={w.id} win={w} />
      ))}
    </>
  );
}

function KeepaliveFrame({ win }: { win: Win }) {
  const visible = !win.minimized;
  return (
    <div
      data-window-id={win.id}
      aria-hidden={visible ? undefined : true}
      inert={!visible}
      className={`absolute inset-0 ${visible ? "pointer-events-auto" : "pointer-events-none invisible"}`}
    >
      <WindowContent win={win} />
    </div>
  );
}
