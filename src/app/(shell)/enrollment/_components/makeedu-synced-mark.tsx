"use client";

import type { MouseEvent, PointerEvent } from "react";
import { useModuleOn } from "@/features/owner/operations-context";

const TITLE = "메이크에듀 동기화 완료 — 누르면 메이크에듀 상담 화면을 엽니다";

/**
 * '메이크에듀 동기화 완료' 표식(원장 2026-10-20) — 이름 **왼쪽**에 선다(오른쪽은 '반 배정 완료'가 자리를 먹는다).
 * 그림은 codex 이미지 생성물(`public/marks/` — 탭 아이콘 세트 `public/icons/`와 따로 둔다: 그쪽 가드는
 * 메뉴가 안 쓰는 그림을 고아로 본다).
 *
 * ⚠️ 카드 전체가 링크(WindowLink)라 `<a>`를 겹칠 수 없다 → span + `window.open`. 누르는 것이 카드 창 열기·
 *    드래그로 새지 않게 클릭·포인터다운을 여기서 멈춘다.
 */
export function MakeeduSyncedMark({ url, size = 22 }: { url: string; size?: number }) {
  // makeedu 기능이 꺼진 학원엔 흔적 없이(MakeeduOriginTag와 같은 스위치).
  const makeeduOn = useModuleOn("makeedu");
  if (!makeeduOn) return null;
  const stop = (e: MouseEvent | PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <span
      role="link"
      tabIndex={0}
      title={TITLE}
      aria-label={TITLE}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        stop(e);
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        window.open(url, "_blank", "noopener,noreferrer");
      }}
      className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full transition hover:brightness-95"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 128px 정적 PNG, 메뉴 글리프와 같은 방식 */}
      <img src="/marks/makeedu-synced.png" alt="" width={size} height={size} draggable={false} />
    </span>
  );
}
