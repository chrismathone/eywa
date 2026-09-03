"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EyIcon } from "@/components/icons/eywa-icons";
import { enrollmentHref, type EnrollmentQuery } from "./enrollment-query";

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
 * 연·월 직접 선택 — 달력 아이콘을 눌러 연도 이동 + 12개월 격자에서 고른다.
 * 배경(원장 2026-08-04): 화살표만 있어서 2023년까지 가려면 40번 넘게 눌러야 했다(이관으로 2023-01까지 생김).
 *
 * 🔑 **트리거가 라벨에서 아이콘으로 바뀌었다**(2026-09-01) — 달 라벨은 이제 앱 전역 단일 소스
 *    [PeriodNav](@/components/period-nav)가 그리고, 그 라벨은 "눌러서 이번 달로"라는 **다른 뜻**을
 *    갖는다. 한 글자에 두 동작을 얹으면 어느 쪽도 예측이 안 되므로 선택은 옆 칸으로 뺐다
 *    (ECS 오늘 면이 하루 이동 옆에 달력을 두는 것과 같은 배치).
 * ⚠️ 남은 자리는 좁으니 라벨을 다시 트리거로 되돌리지 말 것.
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
        className={`border-line hover:bg-bg-soft inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition ${
          // 달 필터가 실제로 걸려 있을 때만 진하게 — 기간 프리셋(3개월 등)으로 보는 중엔 옆 라벨이
          // "그냥 이번 달"이라는 뜻이라 아이콘까지 강조하면 고른 달처럼 읽힌다.
          monthFilterActive ? "text-foreground" : "text-text-dim hover:text-foreground"
        }`}
        aria-label="연·월 선택"
        title="연·월 직접 선택"
      >
        <EyIcon name="calendar" size={13} strokeWidth={2.5} />
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
                  className="text-text-faint num rounded-lg py-1.5 text-center text-sm opacity-40"
                >
                  {m}월
                </span>
              );
            return (
              <Link
                key={m}
                href={enrollmentHref({ ...base, month: key })}
                onClick={() => setOpen(false)}
                className={`num rounded-lg py-1.5 text-center text-sm transition ${
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
