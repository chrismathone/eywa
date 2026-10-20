import { EmbedLink } from "@/components/embed-link";
import { TOOLBAR_SEG_BOX, TOOLBAR_SEG_ITEM, TOOLBAR_SEG_OFF, TOOLBAR_SEG_ON_PRIMARY } from "@/components/toolbar-controls";

/**
 * MCS 목록 보기 — **반별 / 선생님별**(원장 2026-10-20 *"반별로 보이지만 뷰를 선생님 별로해서 … 뷰 하나 추가"*).
 * 두 화면은 주소가 다르다(`/mcs` · `/mcs/teachers`) — 서버가 각자 필요한 것만 조회한다.
 * 창 안에서도 embed를 잃지 않게 `EmbedLink`로 옮긴다.
 */
export function McsViewSwitch({ active }: { active: "classes" | "teachers" }) {
  const item = (key: "classes" | "teachers", href: string, label: string) => (
    <EmbedLink
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`${TOOLBAR_SEG_ITEM} ${active === key ? TOOLBAR_SEG_ON_PRIMARY : TOOLBAR_SEG_OFF}`}
    >
      {label}
    </EmbedLink>
  );
  return (
    <nav className={TOOLBAR_SEG_BOX} aria-label="목록 보기">
      {item("classes", "/mcs", "반별")}
      {item("teachers", "/mcs/teachers", "선생님별")}
    </nav>
  );
}
