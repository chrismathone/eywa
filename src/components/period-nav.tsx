"use client";
import { useSheetLang } from "@/features/teacher-view/lang-context";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons/aywa-icon-compat";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { cn } from "@/lib/utils";
import s from "./period-nav.module.css";
import {
  PERIOD_NAV_ARROW_BOX,
  PERIOD_NAV_ARROW_ICON,
  PERIOD_NAV_BOX,
  PERIOD_NAV_LABEL_BASE,
  PERIOD_NAV_LABEL_BOX,
  PERIOD_NAV_ROW,
  periodNavLabelWidth,
} from "./period-nav-metrics";

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
 * ⚠️ **화살표는 `<a href>`가 아니라 버튼이다** — Ctrl/⌘·가운데 클릭으로 새 탭이 안 열린다(옮겨 오기 전
 *    시간표 주 네비는 열렸다). 이 앱에서 다른 기간을 따로 띄우는 정식 경로는 **사이드바 shift-클릭 창**이라
 *    실사용 손실이 없다고 보고 모양의 일관성을 택했다. 되살릴 땐 **여기**를 고칠 것(호출부에서 링크로
 *    되돌리면 화면마다 다시 갈린다).
 * ⚠️ 이동은 `startTransition` + `router.push`라 **이전 화면을 유지한 채** 새 데이터를 받는다
 *    (`<Link>`면 `loading.tsx` 스켈레톤이 떠서 보고 있던 표가 지워졌다 다시 그려진다 — ParamLink 선례).
 *    저장 flush가 필요한 화면(ECS 주간 시트)은 `onNavigate`로 가로채 자기 순서를 지킨다.
 */
export type PeriodRelation = "past" | "current" | "future";

const RELATION_BADGE: Record<
  Exclude<PeriodRelation, "current">,
  { label: string; en: string; tone: string }
> = {
  past: { label: "과거 조회", en: "Past period", tone: "bg-amber-soft text-amber" },
  future: { label: "미래 조회", en: "Future period", tone: "bg-blue-soft text-blue" },
};

export function PeriodNav({
  label,
  mobileLabel,
  labelControl,
  prevHref,
  nextHref,
  currentHref,
  relation = "current",
  prevAriaLabel,
  nextAriaLabel,
  currentTitle,
  labelWidth: labelWidthBase = PERIOD_NAV_LABEL_BASE,
  pending: externalPending = false,
  onNavigate,
  prevDisabled = false,
  nextDisabled = false,
}: {
  /** 가운데에 적을 기간 — "2026년 8월" · "8월 3일~9일". 호출부의 포맷 함수를 그대로. */
  label: string;
  /** 같은 기간을 짧게 적은 모바일 라벨. 긴 주간 범위도 양쪽 화살표가 화면 안에 남는다. */
  mobileLabel?: string;
  /** 직접 기간을 선택하는 화면의 중앙 컨트롤. 없으면 기존 '이번 기간으로' 버튼. */
  labelControl?: ReactNode;
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
  /**
   * 라벨 칸 **고정** 폭(px) — 원장 2026-09-01 *"처음부터 디폴트 크기를 적당히 잡아서 이동해도 크기
   * 변동안되고 고정되게"*.
   * 🔴 **최소 폭이 아니라 고정 폭이다.** 최소 폭이면 "9월 2주차 (7일~13일)"과 "12월 5주차 (28일~1/3일)"의
   *    글자 수가 달라 **주를 옮길 때마다 화살표가 좌우로 흔들린다**(원장이 지적한 그 움직임).
   * ⚠️ 그래서 값은 그 화면 라벨의 **가장 긴 경우**에 맞춘다 — 좁게 잡으면 글자가 칸을 넘는다
   *    (잘라내지 않는다: 날짜가 잘린 라벨은 흔들리는 것보다 나쁘다).
   */
  labelWidth?: number;
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
  /**
   * 그 방향에 더 갈 기간이 없으면(데이터 경계 — 공휴일 표의 2024·2030년) 화살표를 **잠근다**.
   * 🔴 같은 href를 넘겨 "눌리는데 아무 일도 없게" 만들지 말 것 — `router.push(같은 URL)`가 재조회 + 히스토리 항목을 남긴다.
   */
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  const lang = useSheetLang();
  const router = useRouter();
  const embed = useEmbed();
  const [pending, startTransition] = useTransition();
  const [handing, setHanding] = useState(false);
  const isCurrent = relation === "current";
  const badge = isCurrent ? null : RELATION_BADGE[relation];
  /**
   * 🔴 **지금 어느 쪽으로 벗어나 있는지 화살표에 칠한다**(원장 2026-09-01, 앱 전체 규칙):
   * 미래를 보는 중이면 **오른쪽**, 과거를 보는 중이면 **왼쪽** 화살표가 학원 색(primary)으로 찬다.
   * 배지와 같은 사실을 말하지만 배지는 글자라 눈이 늦게 가고, 화살표는 손이 가는 자리다.
   * ⚠️ '이번 기간'이면 둘 다 평범하다(항상 하나가 칠해져 있으면 신호가 아니다).
   */
  // ⚠️ 잠긴 화살표엔 채색을 얹지 않는다 — `disabled:hover:*`가 `lit`의 hover 톤을 이겨 마우스를 얹으면 색이 빠진다
  //    (잠긴 컨트롤이 hover에 반응하는 꼴). '과거/미래 조회' 배지가 같은 신호를 들고 있어 잃는 게 없다.
  const litPrev = relation === "past";
  const litNext = relation === "future";

  const go = (raw: string) => {
    // 🔴 창(iframe) 안이면 이동 주소에 embed=1을 싣는다(FaceTabs와 같은 규칙) — 빼면 주소에서 embed가 지워지고,
    //    그 뒤 `router.refresh()`(출석부 정렬·기간 저장)·서버 액션 재검증이 공유 레이아웃을 embed 없는 주소로
    //    다시 받아 **창 안에 전체 셸**이 뜬다(메뉴·창 이동 전수검사 2026-09-11). 가로챈 화면(onNavigate)도 이 주소를 받는다.
    // ⚠️ 주소가 아닌 값(원스크린은 날짜 문자열을 넘긴다)엔 withEmbed가 손대지 않는다(앱 경로·상대 쿼리만 — embed-context.tsx).
    const href = embed ? withEmbed(raw) : raw;
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

  // 높이·라벨은 control-scale 한 벌(--control-label / --control-fill) — 공용 `<Button>`·툴바 칩과
  //    같은 값이라 한 줄에 나란히 서도 밑선이 맞는다. 세로 패딩으로 높이를 만들지 말 것(글자 크기가 바뀌면 흔들린다).
  //    (09-01 "h-8 고정"은 이 규칙으로 대체.)
  const arrow =
    `${PERIOD_NAV_ARROW_BOX} text-text-dim hover:text-primary hover:bg-bg-soft cursor-pointer transition disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-dim`;

  // 칠해진 화살표 — hover 톤까지 덮어써야 마우스를 얹었을 때 색이 도로 풀리지 않는다.
  const lit =
    "bg-primary text-primary-foreground hover:bg-primary-deep hover:text-primary-foreground";

  // 🔴 폭은 **고정**(원장 2026-09-01 "이동해도 크기 변동 안 되고 고정되게" — min이면 글자 수가 바뀔 때 화살표가 움찔한다).
  //    호출부의 labelWidth는 옛 13px 라벨에 맞춘 값이라 v5 라벨(18px)에 맞춰 1.4배로 도출한다(고정폭은 그대로) —
  //    도출은 period-nav-metrics.ts 한 곳(스켈레톤 PeriodNavSkeleton과 같은 함수).
  const desktopLabelWidth = periodNavLabelWidth(labelWidthBase);
  const labelWidth = mobileLabel ? "var(--period-label-width)" : desktopLabelWidth;

  return (
    <div
      className={`${PERIOD_NAV_ROW} ${mobileLabel ? s.responsive : ""}`}
      style={mobileLabel ? { "--period-label-desktop": `${desktopLabelWidth}px` } as CSSProperties : undefined}
    >
      <div
        className={`${PERIOD_NAV_BOX} ${
          pending || handing || externalPending ? "opacity-70" : ""
        }`}
      >
        <button
          type="button"
          className={cn(arrow, litPrev && !prevDisabled && lit)}
          aria-label={prevAriaLabel ?? (lang === "en" ? "Previous" : "이전")}
          disabled={prevDisabled}
          onClick={() => go(prevHref)}
        >
          <ChevronLeft className={PERIOD_NAV_ARROW_ICON} />
        </button>
        {labelControl ? (
          <div
            className={PERIOD_NAV_LABEL_BOX}
            style={{ width: labelWidth }}
          >
            {labelControl}
          </div>
        ) : (
          <button
            type="button"
            // 이미 이번 기간이면 눌러도 갈 곳이 없다 — 비활성으로 그 사실을 모양에 담는다.
            disabled={isCurrent}
            className={`${PERIOD_NAV_LABEL_BOX} num px-2 text-center text-(length:--control-label) leading-none font-bold whitespace-nowrap transition ${
              isCurrent
                ? "text-foreground cursor-default"
                : "text-foreground hover:bg-bg-soft cursor-pointer"
            }`}
            style={{ width: labelWidth }}
            aria-label={mobileLabel ? label : undefined}
            title={
              isCurrent ? undefined : (currentTitle ?? (lang === "en" ? "Go to the current period" : "눌러서 이번 기간으로"))
            }
            onClick={() => go(currentHref)}
          >
            {mobileLabel ? <><span className={s.fullLabel}>{label}</span><span className={s.mobileLabel} data-period-label="mobile" aria-hidden>{mobileLabel}</span></> : label}
          </button>
        )}
        <button
          type="button"
          className={cn(arrow, litNext && !nextDisabled && lit)}
          aria-label={nextAriaLabel ?? (lang === "en" ? "Next" : "다음")}
          disabled={nextDisabled}
          onClick={() => go(nextHref)}
        >
          <ChevronRight className={PERIOD_NAV_ARROW_ICON} />
        </button>
      </div>
      {badge ? (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-bold whitespace-nowrap ${badge.tone}`}
        >
          {lang === "en" ? badge.en : badge.label}
        </span>
      ) : null}
    </div>
  );
}
