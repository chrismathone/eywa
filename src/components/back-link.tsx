"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useEmbed } from "@/components/workspace/embed-context";

/**
 * 페이지 상단 "← …로" 뒤로 링크. 플로팅 창(임베드) 안에서는 창 크롬이 뒤로(←)·제목을 제공하므로
 * 렌더하지 않는다(Idea A — 중복 내비 제거). 배경 풀페이지(비임베드)에서는 그대로 표시.
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
  if (embed) return null;
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
