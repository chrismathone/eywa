"use client";

import Link from "next/link";
import { useMenuPresentation, useNavigationSettings } from "@/features/owner/navigation-context";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { hubDestinationForPath } from "@/lib/menu-hub";
import { useEffect, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { faceTabOverflow, faceTabScrollTo } from "@/components/face-tab-scroll";
import { FACE_TAB_ITEM, FACE_TABS_NAV, FACE_TABS_NAV_LEVEL } from "@/components/face-tabs-classes";
import { useSheetText } from "@/features/teacher-view/lang-context";

/**
 * 면 전환 — 한 창 안에서 여러 "면"을 바꾸는 표준 상단 가로 탭바. 수납관리·학생상세·학원설정 등
 * 다면 창 전부 이걸로 통일한다(디자인 시스템 § 다면 창 = 상단 가로 탭바). 메커니즘은 URL `?tab=`
 * (면마다 서버렌더 → 무거운 면만 지연 로딩, 딥링크·창 타이틀 동기·뒤로가기 공짜).
 *
 * - 넘치면 **스크롤바 없이** 가로 스크롤하고, 좌우 버튼을 그 방향으로만 켠다. 버튼은 넘칠 때
 *   둘 다 자리를 유지한다(끝에서 치우면 너비가 늘어 다시 넘친다). 넘치는 쪽만 페이드.
 * - 마운트 시 **활성 탭을 보이게** 스크롤(딥링크로 오른쪽 끝 면에 들어와도 잘림 방지).
 * - `replace`로 전환해 탭 클릭이 창 뒤로(←) 스택을 더럽히지 않는다.
 * - **embed(창) 모드면 href에 자동으로 embed=1 유지**(useEmbed) → 창 안 크롬리스 유지.
 * - `group`이 바뀌는 경계에 세로 구분선(설정 ┃ 관리 식 영역 분리).
 * - `customLabels={false}` — 칸이 목적지가 아니라 **묶음**(범주)일 때. 그 주소에 붙인 사용자 지정 이름·아이콘을 따라가지 않는다
 *   (묶음의 주소는 그 안의 첫 면이라, 그 면을 개명하면 묶음 이름까지 바뀌어 버린다).
 */
export type Face = { key: string; label: string; href: string; group?: string };

export function FaceTabs({
  faces,
  active,
  ariaLabel = "면 전환",
  level = "primary",
  customLabels = true,
}: {
  faces: Face[];
  active: string;
  ariaLabel?: string;
  level?: "primary" | "secondary";
  customLabels?: boolean;
}) {
  const text = useSheetText();
  const embed = useEmbed();
  const presentation = useMenuPresentation();
  const { menus, source } = useNavigationSettings();
  const scrollerRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ overflow: false, left: false, right: false });

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setEdges(faceTabOverflow(el.scrollWidth, el.clientWidth, el.scrollLeft));
    };
    // 마운트 시 활성 탭이 화면 밖이면 보이게 스크롤(페이지 세로 스크롤 없이 nav만).
    const activeEl = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (activeEl) {
      const target = activeEl.offsetLeft - el.clientWidth / 2 + activeEl.offsetWidth / 2;
      el.scrollLeft = Math.max(0, target);
    }
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [faces.length, active]);

  const scrollByDir = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: faceTabScrollTo(el.scrollLeft, el.clientWidth, el.scrollWidth, direction), behavior: "smooth" });
  };

  return (
    <div className="flex min-w-0 items-stretch">
      {edges.overflow ? (
        <TabScrollButton direction={-1} enabled={edges.left} onClick={() => scrollByDir(-1)} />
      ) : null}
      <div className="relative min-w-0 flex-1">
      <nav
        ref={scrollerRef}
        aria-label={text(ariaLabel)}
        // URL을 여는 링크 탐색이다. 버튼 탭의 ARIA 역할 대신 현재 페이지를 알린다.
        // 치수는 스켈레톤(face-tabs-skeleton.tsx)과 같은 상수 — 여기서 고치면 로딩 화면도 따라온다.
        className={`${FACE_TABS_NAV} ${FACE_TABS_NAV_LEVEL[level]}`}
      >
        {faces.map((f, i) => {
          const on = f.key === active;
          const destination = hubDestinationForPath(f.href, source.flatMap((g) => g.items));
          const url = new URL(f.href, "https://navigation.invalid");
          const base = destination ? new URL(destination.href, url.origin) : null;
          // 날짜/필터가 붙은 같은 면은 개명하되 상세 레코드의 다른 면까지 부모 이름으로 덮지 않는다.
          const sameFace = base?.pathname === url.pathname && (!url.searchParams.has("tab") || base.searchParams.get("tab") === url.searchParams.get("tab"));
          const override = customLabels && sameFace ? menus.find((r) => r.href === destination?.href) : undefined;
          const custom = override ? presentation(f.href) : undefined;
          const newGroup = i > 0 && f.group !== faces[i - 1].group;
          return (
            <span key={f.key} className="flex shrink-0 items-center">
              {newGroup ? <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" /> : null}
              <Link
                href={embed ? withEmbed(f.href) : f.href}
                replace
                aria-current={on ? "page" : undefined}
                className={`${FACE_TAB_ITEM} text-(length:--control-label) leading-none whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
                  on
                    ? level === "primary" ? "bg-primary text-primary-foreground font-medium" : "bg-primary-soft text-primary font-bold"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft font-medium"
                }`}
              >
                {override?.icon && custom ? <MenuGlyph name={custom.icon} size={16} className="mr-1.5" /> : null}
                {text(override?.label && custom ? custom.label : f.label)}
              </Link>
            </span>
          );
        })}
      </nav>
      {/* 넘치는 쪽만 페이드 — 스크롤 더 있음을 알림. 클릭 통과. */}
      {edges.left ? (
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-y-px left-px w-10 rounded-l-lg bg-gradient-to-r to-transparent"
        />
      ) : null}
      {edges.right ? (
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-y-px right-px w-10 rounded-r-lg bg-gradient-to-l to-transparent"
        />
      ) : null}
      </div>
      {edges.overflow ? (
        <TabScrollButton direction={1} enabled={edges.right} onClick={() => scrollByDir(1)} />
      ) : null}
    </div>
  );
}

function TabScrollButton({
  direction,
  enabled,
  onClick,
}: {
  direction: -1 | 1;
  enabled: boolean;
  onClick: () => void;
}) {
  const text = useSheetText();
  return (
    <button
      type="button"
      aria-label={text(direction < 0 ? "앞쪽 탭 보기" : "뒤쪽 탭 보기")}
      aria-hidden={enabled ? undefined : true}
      tabIndex={enabled ? 0 : -1}
      disabled={!enabled}
      onClick={onClick}
      className={`text-text-dim hover:text-foreground inline-flex h-(--control-h) w-8 shrink-0 items-center justify-center rounded-md disabled:pointer-events-none ${enabled ? "" : "invisible"}`}
    >
      <EyIcon name={direction < 0 ? "chevronLeft" : "chevronRight"} size={16} />
    </button>
  );
}
