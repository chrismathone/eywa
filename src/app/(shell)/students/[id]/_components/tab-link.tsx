"use client";

import Link from "next/link";
import { ArrowRight } from "@/components/icons/eywa-icon-compat";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

/** 개요 다이제스트 카드 → 해당 탭으로 이동. 창(embed) 안에선 embed=1 유지(풀셸 이중노출 방지). */
export function TabLink({ href, children }: { href: string; children: React.ReactNode }) {
  const embed = useEmbed();
  return (
    <Link
      href={embed ? withEmbed(href) : href}
      className="text-text-dim hover:text-primary inline-flex items-center gap-0.5 text-[11px]"
    >
      {children}
      <ArrowRight className="size-3" />
    </Link>
  );
}
