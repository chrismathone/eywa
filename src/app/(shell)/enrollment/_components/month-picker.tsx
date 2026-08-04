"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EyIcon } from "@/components/icons/eywa-icons";
import { enrollmentHref, formatMonthLabel, type EnrollmentQuery } from "./enrollment-query";

type Props = {
  /** 지금 보고 있는 달("YYYY-MM"). 전체 보기여도 표시는 이 달로 한다(기존 동작 유지). */
  displayMonth: string;
  /** '전체'가 선택돼 월 필터가 없는 상태 — 달 칩을 강조하지 않는다. */
  monthFilterActive: boolean;
  /** 나머지 필터 — 달만 갈아끼우고 그대로 보존한다. */
  base: Omit<EnrollmentQuery, "month">;
  /** 데이터가 있는 가장 이른 연도. 그 아래로는 볼 게 없어 연도 이동을 막는다. */
  minYear: number;
  /** 오늘이 속한 달("YYYY-MM") — 미래 달을 비활성화하는 기준(서버에서 내려받아 하이드레이션 불일치 방지). */
  todayMonth: string;
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/**
 * 연·월 직접 선택 — 라벨을 눌러 연도 이동 + 12개월 격자에서 고른다.
 * 배경(원장 2026-08-04): 화살표만 있어서 2023년까지 가려면 40번 넘게 눌러야 했다(이관으로 2023-01까지 생김).
 */
export function MonthPicker({ displayMonth, monthFilterActive, base, minYear, todayMonth }: Props) {
  const [open, setOpen] = useState(false);
  // 팝오버 안에서 훑어보는 연도 — 실제 필터는 월을 눌러야 바뀐다(연도 이동만으로 화면이 안 튀게).
  const [year, setYear] = useState(() => Number(displayMonth.slice(0, 4)));
  const maxYear = Number(todayMonth.slice(0, 4));
  const selectedYear = Number(displayMonth.slice(0, 4));
  const selectedMonth = Number(displayMonth.slice(5, 7));

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        // 열 때마다 지금 보고 있는 달의 연도에서 시작 — 지난번에 훑던 연도가 남아 있으면 헷갈린다.
        if (next) setYear(selectedYear);
      }}
    >
      <DropdownMenuTrigger
        className={`num inline-flex min-w-[92px] items-center justify-center gap-1 rounded-full px-2 py-0.5 text-[13px] font-bold transition ${
          monthFilterActive ? "text-foreground hover:bg-bg-soft" : "text-text-dim hover:bg-bg-soft"
        }`}
        aria-label="연·월 선택"
      >
        {formatMonthLabel(displayMonth)}
        <EyIcon name="chevronDown" size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-2">
        {/* 연도 이동 — 데이터가 있는 범위 밖으로는 못 나간다(빈 화면으로 걸어 들어가지 않게). */}
        <div className="mb-1.5 flex items-center justify-between px-1">
          <button
            type="button"
            onClick={() => setYear((y) => Math.max(minYear, y - 1))}
            disabled={year <= minYear}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="이전 연도"
          >
            <EyIcon name="chevronLeft" size={14} />
          </button>
          <span className="num text-foreground text-sm font-bold">{year}년</span>
          <button
            type="button"
            onClick={() => setYear((y) => Math.min(maxYear, y + 1))}
            disabled={year >= maxYear}
            className="border-line hover:bg-bg-soft inline-flex size-7 items-center justify-center rounded-full border disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="다음 연도"
          >
            <EyIcon name="chevronRight" size={14} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1">
          {MONTHS.map((m) => {
            const key = `${year}-${String(m).padStart(2, "0")}`;
            const isSelected = monthFilterActive && year === selectedYear && m === selectedMonth;
            // 미래 달은 데이터가 있을 수 없어 막는다(누르면 빈 화면).
            const isFuture = key > todayMonth;
            if (isFuture)
              return (
                <span
                  key={m}
                  className="text-text-faint num rounded-lg py-1.5 text-center text-[13px] opacity-40"
                >
                  {m}월
                </span>
              );
            return (
              <Link
                key={m}
                href={enrollmentHref({ ...base, month: key })}
                onClick={() => setOpen(false)}
                className={`num rounded-lg py-1.5 text-center text-[13px] transition ${
                  isSelected
                    ? "bg-foreground text-background font-bold"
                    : "text-foreground hover:bg-bg-soft"
                }`}
              >
                {m}월
              </Link>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
