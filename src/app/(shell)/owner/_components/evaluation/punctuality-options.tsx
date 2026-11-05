"use client";

import { createContext, useContext } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WEEKDAYS, WEEKDAY_LABEL, type PunctualityOptions, type StaffHours } from "@/features/teacher-portfolio/evaluation/options";
import { NumField } from "./scoring-editor";
import { useWriteLock } from "../write-lock-context";

/**
 * 강사 근태의 '세는 법'(원장 2026-10-15 *"추천으로 진행. 직원마다 일부 출근시간 퇴근시간 다른 직원이 있음"*).
 * 메이크에듀 출퇴근 시각을 그날 기준과 견준다 — 기준 = 그날 맡은 첫 수업 시작(− 분) · 마지막 수업 끝, 또는 직원마다 넣은 요일별 출퇴근 시각.
 * ⚠️ 무엇을 세는지를 바꾸는 칸이라 미리보기엔 안 보이고, 저장 뒤 다시 매긴 점수에 반영된다.
 */
export type StaffOption = { id: string; name: string };
/** 개인 출퇴근 시각을 고를 직원 — 편집기가 미리보기의 강사 목록으로 채운다(새 조회 없음). */
export const EvaluationStaffContext = createContext<readonly StaffOption[]>([]);

const BOX = "space-y-2 rounded-lg border border-line-faint px-3 py-2.5";
const clamp = (n: number | null, lo: number, hi: number, fallback: number) => Math.min(hi, Math.max(lo, n ?? fallback));

export function PunctualityOptionsEditor({ value, onChange, label }: { value: PunctualityOptions; onChange: (next: PunctualityOptions) => void; label: string }) {
  const staff = useContext(EvaluationStaffContext);
  const { locked } = useWriteLock();
  const setHours = (hours: StaffHours[]) => onChange({ ...value, hours });
  const patch = (i: number, next: Partial<StaffHours>) => setHours(value.hours.map((h, j) => (j === i ? { ...h, ...next } : h)));
  const weight = (key: "late" | "absent" | "early", title: string) => (
    <label className="flex items-center gap-1.5">{title}
      <NumField label={`${label} — ${title} 가중`} className="w-16" value={value[key]} onChange={(n) => onChange({ ...value, [key]: clamp(n, 0, 10, 1) })} />회</label>
  );
  return (
    <fieldset className={BOX}>
      <legend className="px-1 text-sm font-medium">세는 법</legend>
      <p className="text-xs">메이크에듀 출퇴근 시각을 그날 기준과 견줍니다. 기준은 그날 맡은 첫 수업 시작과 마지막 수업 끝입니다. 늦게 출근하면 지각, 일찍 퇴근하면 조퇴, 기준이 있는 날 출근 기록이 없으면 결근입니다(그날 직접 쓴 출결·보고서가 있으면 출근으로 보고, 그 시각이 출근 태그보다 이르면 그때 온 것으로 봅니다). 결재된 휴가와 휴원일은 늘 뺍니다.</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-medium">한 번을 몇 회로</span>{weight("late", "지각")}{weight("absent", "결근")}{weight("early", "조퇴")}
        <label className="flex items-center gap-1.5">수업 시작
          <NumField label={`${label} — 수업 몇 분 전까지 출근`} className="w-16" value={value.beforeMinutes}
            onChange={(n) => onChange({ ...value, beforeMinutes: Math.round(clamp(n, 0, 240, 0)) })} />분 전까지 출근</label>
        <label className="flex items-center gap-1.5">
          <NumField label={`${label} — 지각·조퇴로 세지 않는 분`} className="w-16" value={value.graceMinutes}
            onChange={(n) => onChange({ ...value, graceMinutes: Math.round(clamp(n, 0, 60, 5)) })} />분까지는 지각·조퇴로 세지 않음</label>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">개인 출퇴근 시각 <small className="text-xs font-normal">출퇴근 시각이 따로 정해진 직원 — 고른 요일엔 수업 대신 이 시각이 기준입니다(같은 직원·요일이 여러 줄이면 위의 줄).</small></p>
        {value.hours.map((h, i) => (
          <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-staff-hours>
            <select aria-label={`${label} — 개인 시각 ${i + 1} 직원`} value={h.userId} onChange={(e) => patch(i, { userId: e.target.value })}
              className="border-line bg-card min-h-(--control-h) rounded-lg border px-2">
              {staff.some((s) => s.id === h.userId) ? null : <option value={h.userId}>목록에 없는 직원</option>}
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <span className="flex items-center gap-1">
              {WEEKDAYS.map((d) => (
                <label key={d} className="flex items-center gap-0.5">
                  <input type="checkbox" className="size-4" checked={h.days.includes(d)} aria-label={`${label} — 개인 시각 ${i + 1} ${WEEKDAY_LABEL[d]}요일`}
                    onChange={(e) => {
                      const days = e.target.checked ? WEEKDAYS.filter((x) => x === d || h.days.includes(x)) : h.days.filter((x) => x !== d);
                      if (days.length) patch(i, { days });
                    }} />{WEEKDAY_LABEL[d]}
                </label>
              ))}
            </span>
            <label className="flex items-center gap-1">출근
              <Input type="time" className="w-36" aria-label={`${label} — 개인 시각 ${i + 1} 출근`} value={h.start}
                onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) patch(i, { start: e.target.value }); }} /></label>
            <label className="flex items-center gap-1">퇴근
              <Input type="time" className="w-36" aria-label={`${label} — 개인 시각 ${i + 1} 퇴근`} value={h.end ?? ""}
                onChange={(e) => patch(i, { end: /^\d{2}:\d{2}$/.test(e.target.value) ? e.target.value : null })} /></label>
            {locked ? null : <Button type="button" size="sm" variant="ghost" onClick={() => setHours(value.hours.filter((_, j) => j !== i))}>삭제</Button>}
          </div>
        ))}
        {locked ? null : (
          <Button type="button" size="sm" variant="outline" disabled={!staff.length || value.hours.length >= 200}
            onClick={() => setHours([...value.hours, { userId: staff[0]!.id, days: ["mon", "tue", "wed", "thu", "fri"], start: "13:00", end: "21:00" }])}>
            개인 출퇴근 시각 추가
          </Button>
        )}
      </div>
      <p className="text-xs">저장한 뒤 다시 매긴 점수에 반영됩니다(미리보기엔 보이지 않습니다). 퇴근을 비우면 조퇴를 세지 않습니다.</p>
    </fieldset>
  );
}
