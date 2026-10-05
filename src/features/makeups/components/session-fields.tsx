"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { kstToday } from "@/lib/date-kst";
import { subjectWeekdayPeriods, subjectWeekendPeriods, periodSoloLabel, type PeriodsConfig } from "@/features/timetable/lib/periods";
import { OptionPicker } from "./option-picker";

export function SessionFields({ subject, periods, initialDate, allowJoin = true }: {
  subject: string; periods: PeriodsConfig; initialDate?: string; allowJoin?: boolean;
}) {
  const [date, setDate] = useState(initialDate ?? kstToday());
  const [mode, setMode] = useState("new");
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  const options = day === 0 || day === 6 ? subjectWeekendPeriods(periods) : subjectWeekdayPeriods(subject, periods);
  return <div className="space-y-3">
    <label className="block space-y-1"><span className="block font-medium">실시 날짜</span>
      <Input type="date" name="session_date" required value={date} onChange={e => setDate(e.target.value)} />
    </label>
    {allowJoin ? <label className="block space-y-1"><span className="block font-medium">회차</span>
      <select name="session_mode" value={mode} onChange={e => setMode(e.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2">
        <option value="new">새 회차</option><option value="join">기존 회차에 합류</option>
      </select>
    </label> : null}
    {mode === "join" ? <OptionPicker key={`${subject}:${date}`} kind="sessions" name="session_id" label="합류할 회차" subject={subject} filter={{ session_date: date }} required /> : <>
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionPicker kind="staff" name="teacher_id" label="실시 강사" subject={subject} required />
        <OptionPicker kind="classrooms" name="classroom_id" label="강의실" required />
        <OptionPicker kind="classes" name="class_id" label="합류 수업 반(있는 경우)" subject={subject} />
      </div>
      <fieldset key={date} className="border-line rounded-md border p-3"><legend className="px-1 font-medium">연속 교시 선택</legend>
        <div className="grid gap-2 sm:grid-cols-2">{options.map(period => <label key={period.id} className="flex min-h-8 items-center gap-2">
          <input type="checkbox" name="period_ids" value={period.id} />{periodSoloLabel(period)} · {period.startTime}–{period.endTime}
        </label>)}</div>
      </fieldset>
    </>}
  </div>;
}
