"use client";

import { parseMenuMentions, menuMentionDestination } from "@/features/owner/menu-mentions";
import { useMenuPresentation } from "@/features/owner/navigation-context";
import { WindowLink } from "@/components/workspace/window-link";

/** 공지/요청/답변 공통. 운영자는 기본 이름, 학원에서는 현재 뷰의 메뉴 이름으로 읽는다. */
export function MenuMentionText({ text, defaultNames = false, link = true, onNavigate }: { text: string; defaultNames?: boolean; link?: boolean; onNavigate?: () => void }) {
  const present = useMenuPresentation();
  return <>{parseMenuMentions(text).map((part, index) => {
    if (part.type === "text") return part.text;
    const original = menuMentionDestination(part.href);
    if (!original) return <span key={index} title="현재 제공하지 않는 메뉴">@{part.label}</span>;
    const d = defaultNames ? original : present(part.href) ?? original;
    const title = d.label !== original.label ? `기본 메뉴: ${original.label}` : original.label;
    const className = "bg-primary-soft text-primary inline-block max-w-full rounded px-1 py-0.5 align-baseline font-semibold break-words";
    return link ? <WindowLink key={index} href={original.href} title={d.label} ariaLabel={`${d.label} 열기`} onNavigate={onNavigate} className={className}><span title={title}>@{d.label}</span></WindowLink>
      : <span key={index} title={title} className={className}>@{d.label}</span>;
  })}</>;
}
