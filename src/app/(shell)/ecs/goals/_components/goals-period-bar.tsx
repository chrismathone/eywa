"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PeriodNav } from "@/components/period-nav";
import { ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { setMyEcsGoalsView } from "@/features/class-sheets/server/goals-board-actions";
import { GOALS_BOARD_VIEWS, type GoalsBoardView } from "@/features/class-sheets/lib/goals-board";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 반 계획 보기 상단 — **보기 [일간|주간] · ‹ 기간 › · 오늘 날짜로**
 * (원장 2026-09-23 *"수학 강사시트 참고해서 주간·일간 선택"* · *"이동은 화살표로"* · *"선택한 일간 기준으로 노출"*).
 * 가운데 기간 라벨을 누르면 **달력**이 열린다(*"누르면 달력 나오게"*) — 주차·날짜 드롭다운은 원장 지시로 뺐다
 * (*"좌측에 주간/일간 선택기 있으니까"*).
 * 화살표는 일간이면 하루, 주간이면 한 주씩. 주소는 언제나 `date=` 하나 — 주간은 그 날짜가 든 주를 본다
 * (보기를 바꿔도 보던 날짜가 남는다). 보기 단위는 계정 귀속(`ui_prefs.ecs.goalsView`).
 * ⚠️ 라벨은 서버가 만들어 넘긴다(날짜 포맷 단일 소스를 클라로 끌고 오지 않는다).
 */
export function GoalsPeriodBar({
  view,
  date,
  isToday,
  navLabel,
  prevHref,
  nextHref,
  relation,
}: {
  view: GoalsBoardView;
  date: string;
  isToday: boolean;
  navLabel: string;
  prevHref: string;
  nextHref: string;
  relation: "past" | "current" | "future";
}) {
  const router = useRouter();
  const embed = useEmbed();
  const t = useSheetT();
  const [, startTransition] = useTransition();
  const dateRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const go = (d: string | null) => {
    const href = d ? `/ecs/goals?date=${d}` : "/ecs/goals";
    startTransition(() => router.push(embed ? withEmbed(href) : href));
  };
  const pickView = async (next: GoalsBoardView) => {
    if (saving || next === view) return;
    setSaving(true);
    try {
      const r = await setMyEcsGoalsView(next);
      if (!r.ok) {
        toast.error(t("filter.saveFailed"));
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ToolbarSegment label={t("goals.view")}>
        {GOALS_BOARD_VIEWS.map((v) => (
          <ToolbarSegmentItem key={v} active={view === v} disabled={saving} onClick={() => pickView(v)}>
            {t(v === "day" ? "goals.view.day" : "goals.view.week")}
          </ToolbarSegmentItem>
        ))}
      </ToolbarSegment>
      <PeriodNav
        label={navLabel}
        prevHref={prevHref}
        nextHref={nextHref}
        currentHref="/ecs/goals"
        relation={relation}
        labelWidth={view === "day" ? 152 : 236}
        labelControl={
          <label
            className="num hover:bg-bg-soft relative flex h-full w-full cursor-pointer items-center justify-center px-1 text-(length:--control-label) leading-none font-bold whitespace-nowrap"
            onClick={() => {
              // showPicker는 미지원·제스처 밖이면 throw — 그래도 투명 입력이 칸 전체를 덮어 클릭이 달력을 연다.
              try {
                dateRef.current?.showPicker?.();
              } catch {
                /* 폴백 = 아래 투명 입력 */
              }
            }}
          >
            {navLabel}
            <input
              ref={dateRef}
              type="date"
              value={date}
              onChange={(e) => e.target.value && go(e.target.value)}
              aria-label={t("goals.pickDate")}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
            />
          </label>
        }
      />
      {isToday ? null : (
        <ToolbarChip active={false} onClick={() => go(null)}>
          {t("goals.toToday")}
        </ToolbarChip>
      )}
    </>
  );
}
