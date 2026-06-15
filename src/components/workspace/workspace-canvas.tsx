"use client";

import { useEffect } from "react";
import { useWindowStore } from "./window-store";
import { useIsDesktop } from "./use-is-desktop";
import { FloatingWindow } from "./floating-window";
import { WindowSwitcher } from "./window-switcher";
import { snapTarget } from "./window-geometry";

/**
 * Stage Manager 캔버스 — 현재 라우트 위에 뜨는 fixed 오버레이(pointer-events:none,
 * 창·스위처만 이벤트 수신 → 빈 공간은 아래 페이지/레일로 클릭 통과). 데스크톱 전용.
 * owner=`tenantId:userId` — 복원 레이아웃이 다른 계정 것이면 store가 초기화(메타 누수 방지).
 */
export function WorkspaceCanvas({ owner }: { owner: string }) {
  const isDesktop = useIsDesktop();
  const order = useWindowStore((s) => s.order);
  const windows = useWindowStore((s) => s.windows);
  const focusedId = useWindowStore((s) => s.focusedId);
  const snapPreview = useWindowStore((s) => s.snapPreview);
  const bounds = useWindowStore((s) => s.bounds);
  const setBounds = useWindowStore((s) => s.setBounds);
  const adoptOwner = useWindowStore((s) => s.adoptOwner);

  useEffect(() => {
    const setVp = () => setBounds({ width: window.innerWidth, height: window.innerHeight });
    setVp();
    const done = useWindowStore.persist.rehydrate();
    Promise.resolve(done).then(() => adoptOwner(owner));
    window.addEventListener("resize", setVp);
    return () => window.removeEventListener("resize", setVp);
  }, [owner, setBounds, adoptOwner]);

  if (!isDesktop) return null;

  const preview = snapPreview ? snapTarget(snapPreview, bounds) : null;
  const wins = order.map((id) => windows[id]).filter(Boolean);

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {preview ? (
        <div
          className="border-primary/60 bg-primary/5 pointer-events-none fixed top-0 left-0 rounded-xl border-2"
          style={{ transform: `translate(${preview.x}px, ${preview.y}px)`, width: preview.w, height: preview.h }}
          aria-hidden="true"
        />
      ) : null}
      {wins.map((w, i) => (
        <FloatingWindow key={w.id} win={w} focused={w.id === focusedId} z={i + 1} />
      ))}
      <WindowSwitcher />
    </div>
  );
}
