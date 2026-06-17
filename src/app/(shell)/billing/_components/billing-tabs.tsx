"use client";

import Link from "next/link";
import { useEmbed } from "@/components/workspace/embed-context";

// 수납관리 책갈피(앨범 인덱스 탭) — 배경 풀페이지에서만 표시한다. 플로팅 창(임베드)에선 창 프레임
// 바깥의 진짜 책갈피(WindowBookmarks)가 대체하므로 여기선 숨긴다. 세로쓰기 + 면별 파스텔색.
export type BillingTab = "billing" | "textbooks" | "expenses";

const TABS: { key: BillingTab; label: string; soft: string; ring: string }[] = [
  { key: "billing", label: "수납", soft: "bg-primary-soft text-primary", ring: "ring-primary/40" },
  { key: "textbooks", label: "교재", soft: "bg-blue-soft text-blue", ring: "ring-blue/40" },
  { key: "expenses", label: "지출", soft: "bg-purple-soft text-purple", ring: "ring-purple/40" },
];

function hrefFor(k: BillingTab): string {
  return k === "billing" ? "/billing" : `/billing?tab=${k}`;
}

export function BillingTabs({ active }: { active: BillingTab }) {
  const embed = useEmbed();
  if (embed) return null; // 창에선 외부 책갈피(WindowBookmarks)가 대체
  return (
    <nav
      aria-label="수납관리 면 전환"
      className="fixed top-1/2 right-0 z-20 flex -translate-y-1/2 flex-col gap-1.5"
    >
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            aria-current={on ? "page" : undefined}
            title={t.label}
            className={`border-line flex items-center justify-center rounded-l-md border border-r-0 py-3.5 transition-all duration-150 ${t.soft} ${
              on
                ? `${t.ring} w-9 font-bold shadow-card ring-2 ring-inset`
                : "w-7 opacity-65 hover:w-8 hover:opacity-100"
            }`}
            style={{ writingMode: "vertical-rl", textOrientation: "upright" }}
          >
            <span className="text-[12px] tracking-[0.18em]">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
