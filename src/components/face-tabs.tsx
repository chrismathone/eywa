"use client";

import Link from "next/link";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";

/**
 * 면 전환 — 한 창 안에서 여러 "면"을 바꾸는 표준 상단 가로 탭바. 수납관리·학생상세·학원설정 등
 * 다면 창 전부 이걸로 통일한다(디자인 시스템 § 다면 창 = 상단 가로 탭바). 메커니즘은 URL `?tab=`
 * (면마다 서버렌더 → 무거운 면만 지연 로딩, 딥링크·창 타이틀 동기·뒤로가기 공짜).
 *
 * - 넘치면 가로 스크롤(전역 스크롤바 하네스). 긴 라벨·많은 면 OK.
 * - `replace`로 전환해 탭 클릭이 창 뒤로(←) 스택을 더럽히지 않는다.
 * - **embed(창) 모드면 href에 자동으로 embed=1을 유지**(useEmbed) → 창 안에서 탭 전환해도 크롬리스
 *   유지(안 그러면 iframe 안에 풀셸이 뜬다). 배경 풀페이지에선 plain href.
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
  return (
    <nav
      role="tablist"
      aria-label={ariaLabel}
      className="scrollbar-thin border-border bg-card flex items-center gap-0.5 overflow-x-auto rounded-md border px-1.5 py-1.5"
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
  );
}
