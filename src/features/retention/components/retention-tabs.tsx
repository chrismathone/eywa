"use client";

import { usePathname } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";

const TABS = [
  { href: "/retention", label: "브리핑" },
  { href: "/retention/board", label: "리텐션 보드" },
  { href: "/retention/messages", label: "학부모 메시지" },
  { href: "/retention/campaign", label: "재등록 캠페인" },
];

/** 이탈 방어 기능 내부 서브탭. /retention 는 정확 일치, 나머지는 prefix 매칭. */
export function RetentionTabs() {
  const pathname = usePathname();
  const active = TABS.find((t) => t.href === "/retention" ? pathname === t.href : pathname.startsWith(t.href))?.href ?? "/retention";
  return <FaceTabs faces={TABS.map((t) => ({ ...t, key: t.href }))} active={active} ariaLabel="이탈 방어 화면" />;
}
