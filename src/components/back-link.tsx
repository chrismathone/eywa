"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";

/**
 * 페이지 상단 "← …로" 뒤로 링크. 플로팅 창(임베드) 안에서는 창 크롬이 뒤로(←)·제목을 제공하므로
 * 렌더하지 않는다(Idea A — 중복 내비 제거). 배경 풀페이지(비임베드)에서는 그대로 표시.
 *
 * 숨김 판정은 URL의 ?embed=1(`useEmbed`)뿐 아니라 **물리적 프레임 여부(`useInFrame`)**도 본다.
 * 탭/필터 등 일반 Link 드릴인이 embed=1을 떨어뜨려도(useEmbed=false) 창 안이면 항상 숨겨, 창 타이틀바
 * ←와 인페이지 ←가 **이중**으로 뜨거나(중복 뒤로), 인페이지 ←가 고정 href(/classes 등)로 엉뚱하게
 * 이동하는 버그를 막는다. HideInFrame과 동일한 기준. (배경 최상위 프레임에선 둘 다 false → 정상 표시.)
 */
export function BackLink({
  href,
  label,
  className,
}: {
  href: string;
  label: string;
  className?: string;
}) {
  const embed = useEmbed();
  const inFrame = useInFrame();
  if (embed || inFrame) return null;
  return (
    <Link
      href={href}
      className={
        className ??
        "text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      }
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </Link>
  );
}
