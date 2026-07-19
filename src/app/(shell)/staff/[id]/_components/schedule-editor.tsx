"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Plus, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { updateWorkSchedule } from "@/features/staff/server/account-actions";
import type { WorkSchedule } from "@/features/staff/work-schedule";

const DAYS = [
  ["mon", "월"],
  ["tue", "화"],
  ["wed", "수"],
  ["thu", "목"],
  ["fri", "금"],
  ["sat", "토"],
  ["sun", "일"],
] as const;
type Day = (typeof DAYS)[number][0];
type Range = { start: string; end: string };

function parseInitial(initial: WorkSchedule): Record<Day, Range[]> {
  const out = {} as Record<Day, Range[]>;
  for (const [day] of DAYS) {
    out[day] = (initial[day] ?? []).map((r) => {
      const [start = "", end = ""] = r.split("-");
      return { start, end };
    });
  }
  return out;
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      저장
    </Button>
  );
}

export function ScheduleEditor({
  staffId,
  initial,
  canManage,
}: {
  staffId: string;
  initial: WorkSchedule;
  canManage: boolean;
}) {
  const [byDay, setByDay] = useState<Record<Day, Range[]>>(() => parseInitial(initial));
  const [state, action] = useActionState(updateWorkSchedule, undefined);

  const setRange = (day: Day, i: number, field: keyof Range, value: string) =>
    setByDay((prev) => {
      const next = { ...prev, [day]: prev[day].map((r, idx) => (idx === i ? { ...r, [field]: value } : r)) };
      return next;
    });
  const addRange = (day: Day) =>
    setByDay((prev) => ({ ...prev, [day]: [...prev[day], { start: "09:00", end: "18:00" }] }));
  const removeRange = (day: Day, i: number) =>
    setByDay((prev) => ({ ...prev, [day]: prev[day].filter((_, idx) => idx !== i) }));

  const payload: Record<string, string[]> = {};
  for (const [day] of DAYS) {
    const ranges = byDay[day].filter((r) => r.start && r.end).map((r) => `${r.start}-${r.end}`);
    if (ranges.length > 0) payload[day] = ranges;
  }
  const hasAny = Object.keys(payload).length > 0;

  // 읽기 전용 뷰 (관리 권한 없음)
  if (!canManage) {
    return (
      <div className="bg-card border-line shadow-card rounded-md border p-5">
        <p className="micro mb-3">주간 근무 일정</p>
        {!hasAny ? (
          <p className="text-text-faint text-sm">등록된 근무 일정이 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {DAYS.map(([day, label]) => (
              <li key={day} className="flex items-center gap-3">
                <span className="text-text-dim w-6 text-sm font-medium">{label}</span>
                {byDay[day].length === 0 ? (
                  <span className="text-text-faint text-xs">휴무</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {byDay[day].map((r, i) => (
                      <span
                        key={i}
                        className="border-line bg-bg-soft text-foreground num rounded-sm border px-2 py-0.5 text-xs"
                      >
                        {r.start}–{r.end}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="bg-card border-line shadow-card space-y-3 rounded-md border p-5">
      <input type="hidden" name="id" value={staffId} />
      <input type="hidden" name="schedule" value={JSON.stringify(payload)} />
      <div className="flex items-center justify-between">
        <p className="micro">주간 근무 일정</p>
        {state?.ok ? (
          <span className="text-chart-2 inline-flex items-center gap-1 text-xs">
            <Check className="size-3" /> 저장됨
          </span>
        ) : null}
      </div>

      <ul className="divide-line divide-y">
        {DAYS.map(([day, label]) => (
          <li key={day} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="text-foreground w-6 shrink-0 text-sm font-bold">{label}</span>
            <div className="flex flex-1 flex-wrap items-center gap-2">
              {byDay[day].length === 0 ? (
                <span className="text-text-faint text-xs">휴무</span>
              ) : (
                byDay[day].map((r, i) => (
                  <span key={i} className="border-line bg-bg-soft flex items-center gap-1 rounded-sm border px-1.5 py-1">
                    <input
                      type="time"
                      value={r.start}
                      onChange={(e) => setRange(day, i, "start", e.target.value)}
                      className="num bg-transparent text-xs focus:outline-none"
                    />
                    <span className="text-text-faint text-xs">~</span>
                    <input
                      type="time"
                      value={r.end}
                      onChange={(e) => setRange(day, i, "end", e.target.value)}
                      className="num bg-transparent text-xs focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeRange(day, i)}
                      aria-label="시간대 삭제"
                      className="text-text-faint hover:text-chart-4"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))
              )}
              <button
                type="button"
                onClick={() => addRange(day)}
                className="text-text-dim hover:text-primary inline-flex items-center gap-0.5 text-xs"
              >
                <Plus className="size-3" /> 추가
              </button>
            </div>
          </li>
        ))}
      </ul>

      {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
      <div className="flex justify-end">
        <SaveBtn />
      </div>
    </form>
  );
}
