"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons/eywa-icon-compat";

/**
 * 기간 이동 네비 **단일 소스** — `‹ 2026년 8월 ›` 한 덩어리.
 *
 * 원장 2026-08-31: *"너무 버튼이 많은듯 · `< 2026년 08월 >` 정도면 되고 좌우화살표로 월 이동이면 된다 ·
 * 웹앱내에서 비슷한 곳은 다 방금 지시한 것으로."* 그전까지 같은 일을 하는 네비가 화면마다 제각각이었다
 * (시간표·ECS는 `주 ◀ [이번주] ▶ 라벨`, 출석부는 `◀ 라벨 ▶`, 수납은 화살표만, 캘린더는 `◀ 라벨 ▶ [오늘]`
 * — 아이콘 크기도 13/14/16px로 갈렸다).
 *
 * 🔴 **'이번 주/이번 달' 버튼을 따로 두지 않는다** — 가운데 라벨을 누르면 이번 기간으로 온다.
 *    다만 그 버튼이 겸하던 **"지금 이번 기간인가"** 신호는 사라지면 안 되므로 `relation` 배지가 대신한다
 *    (없애면 과거 화면을 보면서 오늘로 착각한다 — WeekNav가 이 신호를 갖고 있던 이유).
 * ⚠️ 라벨 문자열은 **호출부가 만든다**(`monthLabel`·`weekLabel` 등 앱 전역 단일 소스) — 여기서 포맷을
 *    새로 정하면 같은 달이 화면마다 다르게 적힌다.
 * ⚠️ 이동은 `startTransition` + `router.push`라 **이전 화면을 유지한 채** 새 데이터를 받는다
 *    (`<Link>`면 `loading.tsx` 스켈레톤이 떠서 보고 있던 표가 지워졌다 다시 그려진다 — ParamLink 선례).
 *    저장 flush가 필요한 화면(ECS 주간 시트)은 `onNavigate`로 가로채 자기 순서를 지킨다.
 */
export type PeriodRelation = "past" | "current" | "future";

const RELATION_BADGE: Record<Exclude<PeriodRelation, "current">, { label: string; tone: string }> = {
  past: { label: "과거 조회", tone: "bg-amber-soft text-amber" },
  future: { label: "미래 조회", tone: "bg-blue-soft text-blue" },
};

export function PeriodNav({
  label,
  prevHref,
  nextHref,
  currentHref,
  relation = "current",
  prevAriaLabel,
  nextAriaLabel,
  currentTitle,
  minLabelWidth = 104,
  pending: externalPending = false,
  onNavigate,
}: {
  /** 가운데에 적을 기간 — "2026년 8월" · "8월 3일~9일". 호출부의 포맷 함수를 그대로. */
  label: string;
  prevHref: string;
  nextHref: string;
  /** 라벨을 눌렀을 때 갈 곳(이번 달·이번 주). */
  currentHref: string;
  /** 지금 보고 있는 기간이 오늘 기준 어디인가 — 'current'가 아니면 배지가 뜬다. */
  relation?: PeriodRelation;
  prevAriaLabel?: string;
  nextAriaLabel?: string;
  /** 라벨 버튼 툴팁 — 기본은 "눌러서 이번 기간으로". */
  currentTitle?: string;
  /** 라벨 칸 최소 폭(px) — 기간이 바뀌어도 화살표가 움찔거리지 않게. */
  minLabelWidth?: number;
  /**
   * 호출부가 **자기 전환**을 도는 동안 "가는 중"으로 그린다.
   * 🔴 `onNavigate`를 주면 이 컴포넌트의 자체 transition이 안 돌아 **아무 반응이 없다** — 가로챈 화면이
   *    Promise를 안 돌려주는 경우(시간표 주 이동은 `startTransition`이라 thenable이 없다) 이 prop이
   *    유일한 피드백이다. 없으면 사람이 화살표를 두 번 누른다(ParamLink가 pulse로 하던 일).
   */
  pending?: boolean;
  /**
   * 이동을 가로챈다(저장 flush 등). 주면 링크 대신 이 콜백만 부른다 —
   * 🔴 가로챈 화면은 **자기 순서를 다 지킨 뒤** 실제 이동까지 책임진다(안 하면 버튼이 먹통이 된다).
   */
  onNavigate?: (href: string) => void | Promise<void>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [handing, setHanding] = useState(false);
  const isCurrent = relation === "current";
  const badge = isCurrent ? null : RELATION_BADGE[relation];

  const go = (href: string) => {
    if (onNavigate) {
      // 가로챈 화면이 저장 flush 같은 자기 순서를 지키는 동안에도 "가는 중"이 보여야 한다
      // — 아무 반응이 없으면 사람이 화살표를 두 번 누른다.
      const r = onNavigate(href);
      if (r && typeof (r as { then?: unknown }).then === "function") {
        setHanding(true);
        // Promise.resolve로 감싼다 — thenable이 `finally`를 안 가질 수 있다(있다고 가정하면 TypeError).
        void Promise.resolve(r).finally(() => setHanding(false));
      }
      return;
    }
    startTransition(() => router.push(href));
  };

  const arrow =
    "text-text-dim hover:text-primary hover:bg-bg-soft inline-flex cursor-pointer items-center justify-center px-2.5 py-1.5 transition disabled:cursor-default disabled:opacity-50";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div
        className={`border-line-strong inline-flex items-center overflow-hidden rounded-lg border ${
          pending || handing || externalPending ? "opacity-70" : ""
        }`}
      >
        <button
          type="button"
          className={arrow}
          aria-label={prevAriaLabel ?? "이전"}
          onClick={() => go(prevHref)}
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          type="button"
          // 이미 이번 기간이면 눌러도 갈 곳이 없다 — 비활성으로 그 사실을 모양에 담는다.
          disabled={isCurrent}
          className={`border-line-faint num min-w-0 border-x px-2 py-1 text-[13px] font-bold whitespace-nowrap transition ${
            isCurrent ? "text-foreground cursor-default" : "text-foreground hover:bg-bg-soft cursor-pointer"
          }`}
          style={{ minWidth: minLabelWidth }}
          title={isCurrent ? undefined : (currentTitle ?? "눌러서 이번 기간으로")}
          onClick={() => go(currentHref)}
        >
          {label}
        </button>
        <button
          type="button"
          className={arrow}
          aria-label={nextAriaLabel ?? "다음"}
          onClick={() => go(nextHref)}
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      {badge ? (
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${badge.tone}`}>
          {badge.label}
        </span>
      ) : null}
    </div>
  );
}
