"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

/**
 * 면 전환 — 한 창 안에서 여러 "면"을 바꾸는 표준 상단 가로 탭바. 수납관리·학생상세·학원설정 등
 * 다면 창 전부 이걸로 통일한다(디자인 시스템 § 다면 창 = 상단 가로 탭바). 메커니즘은 URL `?tab=`
 * (면마다 서버렌더 → 무거운 면만 지연 로딩, 딥링크·창 타이틀 동기·뒤로가기 공짜).
 *
 * - 넘치면 **스크롤바 없이** 가로 스크롤 + **넘치는 쪽만 좌우 페이드**(더 있음을 알림). 긴 라벨·많은 면 OK.
 * - 마운트 시 **활성 탭을 보이게** 스크롤(딥링크로 오른쪽 끝 면에 들어와도 잘림 방지).
 * - `replace`로 전환해 탭 클릭이 창 뒤로(←) 스택을 더럽히지 않는다.
 * - **embed(창) 모드면 href에 자동으로 embed=1 유지**(useEmbed) → 창 안 크롬리스 유지.
 * - `group`이 바뀌는 경계에 세로 구분선(설정 ┃ 관리 식 영역 분리).
 */
export type Face = { key: string; label: string; href: string; group?: string };

export function FaceTabs({
  faces,
  active,
  ariaLabel = "면 전환",
}: {
  faces: Face[];
  active: string;
  ariaLabel?: string;
}) {
  const embed = useEmbed();
  const scrollerRef = useRef<HTMLElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      setCanLeft(el.scrollLeft > 1);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
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

  return (
    <div className="relative">
      <nav
        ref={scrollerRef}
        role="tablist"
        aria-label={ariaLabel}
        className="border-border bg-card flex items-center gap-0.5 overflow-x-auto rounded-md border px-1.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {faces.map((f, i) => {
          const on = f.key === active;
          const newGroup = i > 0 && f.group !== faces[i - 1].group;
          return (
            <span key={f.key} className="flex items-center">
              {newGroup ? <span aria-hidden className="bg-border mx-1 h-4 w-px shrink-0" /> : null}
              <Link
                href={embed ? withEmbed(f.href) : f.href}
                replace
                role="tab"
                aria-current={on ? "page" : undefined}
                className={`block shrink-0 rounded-sm px-3 py-1.5 text-xs font-medium whitespace-nowrap transition ${
                  on
                    ? "bg-primary text-primary-foreground"
                    : "text-text-dim hover:text-foreground hover:bg-bg-soft"
                }`}
              >
                {f.label}
              </Link>
            </span>
          );
        })}
      </nav>
      {/* 넘치는 쪽만 페이드 — 스크롤 더 있음을 알림. bg-card에서 투명으로(경계·라운드 안쪽). 클릭 통과. */}
      {canLeft ? (
        <div
          aria-hidden
          className="from-card pointer-events-none absolute inset-y-px left-px w-10 rounded-l-md bg-gradient-to-r to-transparent"
        />
      ) : null}
      {canRight ? (
        <div
          aria-hidden
          className="from-card pointer-events-none absolute inset-y-px right-px w-10 rounded-r-md bg-gradient-to-l to-transparent"
        />
      ) : null}
    </div>
  );
}
