"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Printer } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useEmbed } from "@/components/workspace/embed-context";

// 지출결의서 in-place 인쇄(이미 플로팅 창이라 window.print()가 창 문서만 인쇄 — 계산기 패턴).
// 창이 아닐 때만 목록으로 돌아간다. 강사 본인 결의서는 사무실 수납 장부로 보내지 않는다. print:hidden.
export function ExpensePrintBar() {
  const embed = useEmbed();
  const pathname = usePathname();
  const listHref = pathname.startsWith("/expense-requests") ? "/expense-requests" : "/billing?tab=expenses";
  return (
    <div className={`mx-auto mb-4 flex max-w-[760px] items-center print:hidden ${embed ? "justify-end" : "justify-between gap-2"}`}>
      {embed ? null : (
        <Link href={listHref} className="text-text-dim hover:text-foreground text-sm transition">
          지출 목록으로
        </Link>
      )}
      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" /> 인쇄
      </Button>
    </div>
  );
}
