"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/retention", label: "브리핑" },
  { href: "/retention/board", label: "리텐션 보드" },
  { href: "/retention/messages", label: "학부모 메시지" },
];

/** 이탈 방어 기능 내부 서브탭. /retention 는 정확 일치, 나머지는 prefix 매칭. */
export function RetentionTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {TABS.map((t) => {
        const active = t.href === "/retention" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-sm border px-3 py-1 text-xs transition ${
              active
                ? "border-foreground bg-foreground text-background font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
