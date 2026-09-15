"use client";

import { memo } from "react";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { formatMd, formatMdW, formatRange } from "../calendar";
import { monthOf, resolveWeek } from "../focus";
import { useProgressMap } from "./map-state";
import styles from "./progress-map.module.css";

/** 좁은 원호를 직접 누르지 않아도 툴바에서 주차·날짜를 고를 수 있다. */
export const MapPeriodPicker = memo(function MapPeriodPicker() {
  const { view, focus, selectWeek, selectDay } = useProgressMap();
  const month = monthOf(view, focus.month);
  const week = resolveWeek(view, focus);
  const selectClass = `${styles.pickerSelect} ${CONTROL_H} ${CONTROL_LABEL}`;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="지도 주차·날짜 선택">
      <label className="flex items-center gap-1.5">
        <span className="micro">주차</span>
        <select className={selectClass} aria-label={`${view.year}년 ${month.month}월 주차 선택`}
          value={week.index} data-selected={focus.week !== null ? "true" : undefined}
          onChange={(event) => selectWeek(month.month, Number(event.target.value))}>
          {month.weeks.map((w) => (
            <option key={w.index} value={w.index}>
              {w.index}주 · {w.start === w.end ? formatMd(w.start) : formatRange(w.start, w.end)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="micro">날짜</span>
        <select className={selectClass} aria-label={`${view.year}년 ${month.month}월 ${week.index}주차 날짜 선택`}
          value={focus.day ?? ""} data-selected={focus.day ? "true" : undefined}
          onChange={(event) => selectDay(event.target.value)}>
          <option value="" disabled>날짜 선택</option>
          {week.days.map((day) => <option key={day.date} value={day.date}>{formatMdW(day.date)}</option>)}
        </select>
      </label>
    </div>
  );
});
