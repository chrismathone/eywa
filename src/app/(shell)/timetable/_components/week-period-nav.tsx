"use client";
import { useTimetableText } from "@/features/teacher-view/use-timetable-text";

import { useSheetLang } from "@/features/teacher-view/lang-context";
import { sheetWeekLabel } from "@/features/teacher-view/i18n";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PeriodNav, type PeriodRelation } from "@/components/period-nav";
import { WEEK_LABEL_W } from "@/features/timetable/lib/week";
import { confirmTimetableNav } from "./timetable-unsaved";

/**
 * 주간 이동의 **클라 절반** — [`PeriodNav`](@/components/period-nav)에 시간표의 두 규약을 얹는다.
 *
 * 🔴 **미저장 이탈 가드를 잃지 않으려고** 있는 파일이다. 종전 주 네비는 [`ParamLink`](./param-link.tsx)라
 *    이동 직전에 `confirmTimetableNav()`를 지났는데(원장 2026-08-06 *"편집중에 주 과목 뷰 바꿀때도 경고"*),
 *    PeriodNav를 맨몸으로 쓰면 그 확인이 사라져 **옮겨 둔 배치가 말없이 날아간다**.
 * 🔴 이동은 `startTransition` + `router.push(scroll:false)` — `<Link>`면 `loading.tsx` 스켈레톤이 떠서
 *    보고 있던 시간표가 지워졌다 다시 그려진다(ParamLink 🔴와 같은 이유).
 * ⚠️ `dirty`는 모듈 스코프 플래그라 시간표 편집 보드가 없는 화면(/ecs)에서는 언제나 통과다 —
 *    ParamLink 시절과 **같은 동작**이라 새로 생기는 위험이 없다.
 *
 * 부모(`week-nav.tsx`)가 서버 컴포넌트인 채로 남는 이유: 소비처가 `hrefForWeek`를 **함수로** 넘기는데
 * 함수는 클라 컴포넌트 경계를 못 넘는다. 그래서 주소 계산은 서버에 두고 여기엔 문자열만 온다.
 */
export function WeekPeriodNav({
  label,
  monday,
  mobileLabel,
  prevHref,
  nextHref,
  currentHref,
  relation,
}: {
  label: string;
  monday?: string;
  mobileLabel?: string;
  prevHref: string;
  nextHref: string;
  currentHref: string;
  relation: PeriodRelation;
}) {
  const tt = useTimetableText();
  const lang = useSheetLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <PeriodNav
      label={monday ? sheetWeekLabel(monday, label, lang) : label}
      mobileLabel={mobileLabel}
      prevHref={prevHref}
      nextHref={nextHref}
      currentHref={currentHref}
      relation={relation}
      prevAriaLabel={tt("이전 주")}
      nextAriaLabel={tt("다음 주")}
      currentTitle={tt("눌러서 이번 주로")}
      // 주 라벨의 최장은 달을 걸치는 주 "2026년 12월 5주차 (28일~1/3일)" — 그 폭으로 **고정**한다.
      labelWidth={WEEK_LABEL_W}
      // 🔴 가로챈 이동은 PeriodNav의 자체 transition을 안 태우므로 "가는 중"을 여기서 넘긴다 —
      //    안 넘기면 누른 뒤 새 주가 올 때까지(1~3초) 화면에 아무 반응이 없다(ParamLink는 pulse였다).
      pending={pending}
      onNavigate={(href) => {
        if (!confirmTimetableNav()) return;
        start(() => router.push(href, { scroll: false }));
      }}
    />
  );
}
