"use client";

import { ArrowLeft } from "@/components/icons/aywa-icon-compat";
import { ToolbarButton } from "@/components/toolbar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

/**
 * 통계 화면 → 목록 '목록으로'(원장 2026-10-01 — 지금 걸린 필터를 그대로 들고 간다). **같은 창 안** 이동이라 창이면 `embed=1`을
 * 싣는다([[#133]] — 빠지면 다음 새로고침에 창 안에 전체 셸). `BackLink`는 창 안에서 숨으므로(창 ←와 중복) 쓰지 않는다 —
 * 창 ←는 히스토리를 되감아 통계 화면에서 바꾼 필터를 잃는다.
 */
export function BackToListButton({ href }: { href: string }) {
  const embed = useEmbed();
  return (
    <ToolbarButton href={embed ? withEmbed(href) : href}>
      {/* 크기는 툴바 컨트롤 규약(CONTROL_ICON = 글자 1em)이 정한다. */}
      <ArrowLeft strokeWidth={1.8} />
      목록으로
    </ToolbarButton>
  );
}
