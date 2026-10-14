import { HUB_GROUPS, INNER_TABS, SUPPORT_GROUPS } from "@/lib/menu-hub";
import { TEACHER_NAV_GROUPS } from "@/lib/teacher-navigation";

/**
 * 저장 키는 기본 목적지 주소. 지점의 표시 이름·폴더 ID를 식별자로 사용하지 않는다.
 * 화면 안 내부 탭(수납의 지출 등)은 메뉴에 따로 서지 않지만 실제 화면이라 글에서 가리킬 수 있다(원장 2026-10-14 이전에 쓴 글의 링크도 산다).
 */
const allDestinations = [...HUB_GROUPS, ...SUPPORT_GROUPS, ...TEACHER_NAV_GROUPS, ...INNER_TABS].flatMap((g) => g.items);
// 공통 메뉴의 운영자 이름은 관리자 쪽 기본값을 우선한다.
export const MENU_MENTION_CATALOG = allDestinations.filter((d, index) => allDestinations.findIndex((other) => other.href === d.href) === index);
const byHref = new Map(MENU_MENTION_CATALOG.map((d) => [d.href, d]));
export const menuMentionDestination = (href: string) => byHref.get(href);
export type MenuMentionPart = { type: "text"; text: string } | { type: "menu"; href: string; label: string };

/** 기존 text 열과 호환되는 참조 형식. HTML/임의 외부 주소는 링크로 해석하지 않는다. */
export function menuMentionToken(href: string): string {
  const d = byHref.get(href);
  return d ? `@[${d.label}](menu:${d.href})` : "";
}

export function parseMenuMentions(text: string): MenuMentionPart[] {
  const parts: MenuMentionPart[] = [];
  const pattern = /@\[([^\]\r\n]{1,80})\]\(menu:([^\s)]{1,160})\)/g;
  let cursor = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index > cursor) parts.push({ type: "text", text: text.slice(cursor, m.index) });
    parts.push({ type: "menu", href: m[2], label: m[1] });
    cursor = m.index + m[0].length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
}

/** 번역이 참조를 바꾸거나 떨어뜨린 경우 원문을 유지한다(목적지 손실 방지). */
export function sameMenuMentions(before: string, after: string): boolean {
  const refs = (value: string) => parseMenuMentions(value).filter((p) => p.type === "menu").map((p) => p.href).sort().join("\n");
  return refs(before) === refs(after);
}
