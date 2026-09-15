"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pill } from "@/components/atoms/pill";
import { EyIcon } from "@/components/icons/eywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { RoadmapStep } from "../model";
import { formatYearMonth, monthKey, stepContains } from "../years";
import { useProgressMap } from "./map-state";

/** 고정 높이의 한 줄 과정 목록. 페이지의 세로 위치를 건드리지 않고 선택한 과정만 가운데로 옮긴다. */
export function CurriculumCarousel({ steps }: { steps: RoadmapStep[] }) {
  const { sourceProgress: progress, view, focus, selectPeriod, years } = useProgressMap();
  const listRef = useRef<HTMLOListElement>(null);
  const initialized = useRef(false);
  const selectedIndex = steps.findIndex((step) => Boolean(step.startMonth) && stepContains(step, view.year, focus.month));
  const currentIndex = steps.findIndex((step) => step.id === progress.currentStepId);
  const centerIndex = selectedIndex >= 0 ? selectedIndex : Math.max(0, currentIndex);
  const [visibleIndex, setVisibleIndex] = useState(centerIndex);

  const centerCard = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const list = listRef.current;
    const scroller = list?.parentElement;
    const card = list?.children[index] as HTMLElement | undefined;
    if (!scroller || !card) return;
    const cardBox = card.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    scroller.scrollTo({
      left: scroller.scrollLeft + cardBox.left + cardBox.width / 2 - box.left - scroller.clientWidth / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : behavior,
    });
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const scroller = list?.parentElement;
    const firstCard = list?.firstElementChild as HTMLElement | null;
    if (!list || !scroller || !firstCard) return;
    let width = scroller.clientWidth;
    let cardWidth = firstCard.offsetWidth;
    const pad = () => { list.style.paddingInline = `${Math.max(0, (width - cardWidth) / 2)}px`; };
    pad();
    centerCard(centerIndex, initialized.current ? "smooth" : "instant");
    initialized.current = true;
    const updateIndex = () => {
      const middle = scroller.getBoundingClientRect().left + scroller.clientWidth / 2;
      let closest = 0;
      let distance = Infinity;
      Array.from(list.children).forEach((card, index) => {
        const box = card.getBoundingClientRect();
        const gap = Math.abs(box.left + box.width / 2 - middle);
        if (gap < distance) { closest = index; distance = gap; }
      });
      setVisibleIndex((previous) => previous === closest ? previous : closest);
    };
    scroller.addEventListener("scroll", updateIndex, { passive: true });
    const resize = new ResizeObserver(() => {
      if (width === scroller.clientWidth && cardWidth === firstCard.offsetWidth) return;
      width = scroller.clientWidth;
      cardWidth = firstCard.offsetWidth;
      pad();
      centerCard(centerIndex, "instant");
    });
    resize.observe(scroller);
    resize.observe(firstCard);
    return () => { scroller.removeEventListener("scroll", updateIndex); resize.disconnect(); };
  }, [steps, centerIndex, centerCard]);

  return (
    <div className="relative mt-3" data-curriculum-carousel="">
      <div style={{ maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)" }}>
        <DragScrollArea fade={false} hideBar momentum={false}>
          <ol ref={listRef} className="flex w-max gap-3 py-1" aria-label="장기 커리큘럼">
            {steps.map((step, index) => {
              const current = step.id === progress.currentStepId;
              const done = Boolean(step.endMonth) && step.endMonth < progress.asOf.slice(0, 7);
              const selected = index === selectedIndex;
              const target = selected ? monthKey(view.year, focus.month) : current ? progress.asOf.slice(0, 7) : step.startMonth;
              const enabled = Boolean(target) && years.includes(Number(target.slice(0, 4)));
              const status = current ? "학습 중" : done ? "완료" : step.estimated ? "예상" : "예정";
              return (
                <li key={step.id} className="w-64 shrink-0 sm:w-72">
                  <button
                    type="button"
                    disabled={!enabled}
                    onClick={() => {
                      centerCard(index);
                      selectPeriod(Number(target.slice(0, 4)), Number(target.slice(5, 7)));
                    }}
                    onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) centerCard(index); }}
                    aria-pressed={selected}
                    aria-current={current ? "step" : undefined}
                    aria-label={`${step.label} · ${step.startMonth}~${step.endMonth} · ${status}`}
                    className={`flex h-28 w-full flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      selected ? "border-primary bg-primary text-primary-foreground"
                        : current ? "border-danger text-foreground"
                          : "border-line text-foreground enabled:hover:border-primary enabled:hover:bg-primary-softer"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold whitespace-nowrap">
                        {step.label}
                        <EyIcon name="check" size={14} className={selected ? "" : "invisible"} />
                      </span>
                      <Pill color={current ? "danger" : done ? "green" : "neutral"} soft={!current && !selected} className="shrink-0">{status}</Pill>
                    </span>
                    <span className="num text-xs font-medium whitespace-nowrap">{step.startMonth ? `${formatYearMonth(step.startMonth)} ~ ${formatYearMonth(step.endMonth)}` : "기간 미정"}</span>
                    <span className="line-clamp-2 text-xs leading-relaxed break-keep" title={step.description}>{step.description}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </DragScrollArea>
      </div>
      <button type="button" aria-label="이전 과정 보기" disabled={visibleIndex <= 0} onClick={() => centerCard(Math.max(0, visibleIndex - 1))} className="border-line bg-card text-foreground absolute top-1/2 left-0 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
        <EyIcon name="chevronLeft" size={18} />
      </button>
      <button type="button" aria-label="다음 과정 보기" disabled={visibleIndex >= steps.length - 1} onClick={() => centerCard(Math.min(steps.length - 1, visibleIndex + 1))} className="border-line bg-card text-foreground absolute top-1/2 right-0 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30">
        <EyIcon name="chevronRight" size={18} />
      </button>
    </div>
  );
}
