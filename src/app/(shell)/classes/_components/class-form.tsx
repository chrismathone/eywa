"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createClass,
  updateClass,
  type ClassFormState,
} from "@/features/classes/server/actions";

const SUBJECTS = [
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
  { value: "korean", label: "국어" },
  { value: "science", label: "과학" },
  { value: "arts", label: "예술" },
  { value: "etc", label: "기타" },
];

const DAYS = [
  { value: "mon", label: "월" },
  { value: "tue", label: "화" },
  { value: "wed", label: "수" },
  { value: "thu", label: "목" },
  { value: "fri", label: "금" },
  { value: "sat", label: "토" },
  { value: "sun", label: "일" },
];

type Schedule = { dayOfWeek: string; startTime: string; endTime: string };

export type ClassFormDefaults = {
  id?: string;
  className: string;
  subject: string;
  teacherId: string | null;
  classroomId: string | null;
  isActive: boolean;
  notes: string | null;
  schedules: Schedule[];
};

function Submit({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {mode === "create" ? "반 생성" : "변경 저장"}
    </Button>
  );
}

export function ClassForm({
  mode,
  defaults,
  teacherOptions,
  classroomOptions,
}: {
  mode: "create" | "edit";
  defaults?: ClassFormDefaults;
  teacherOptions: { id: string; name: string }[];
  classroomOptions: { id: string; name: string; capacity: number | null }[];
}) {
  const action = mode === "create" ? createClass : updateClass;
  const [state, formAction] = useActionState<ClassFormState, FormData>(action, undefined);

  const [schedules, setSchedules] = useState<Schedule[]>(
    defaults?.schedules?.length
      ? defaults.schedules
      : [{ dayOfWeek: "mon", startTime: "16:00", endTime: "17:30" }],
  );

  function addSchedule() {
    setSchedules((s) => [
      ...s,
      { dayOfWeek: "mon", startTime: "16:00", endTime: "17:30" },
    ]);
  }

  function removeSchedule(i: number) {
    setSchedules((s) => s.filter((_, idx) => idx !== i));
  }

  function updateSchedule(i: number, patch: Partial<Schedule>) {
    setSchedules((s) =>
      s.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  const fieldErrs = state?.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-5">
      {defaults?.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="반 이름" error={fieldErrs.className}>
          <input
            name="className"
            required
            defaultValue={defaults?.className ?? ""}
            placeholder="예: 중3 수학 심화반"
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>

        <Field label="과목" error={fieldErrs.subject}>
          <select
            name="subject"
            defaultValue={defaults?.subject ?? "math"}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            {SUBJECTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="강사">
          <select
            name="teacherId"
            defaultValue={defaults?.teacherId ?? ""}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">미정</option>
            {teacherOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="강의실">
          <select
            name="classroomId"
            defaultValue={defaults?.classroomId ?? ""}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">미정</option>
            {classroomOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.capacity ? ` (정원 ${r.capacity})` : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="활성 상태" className="sm:col-span-2">
          <label className="text-foreground inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              value="true"
              defaultChecked={defaults?.isActive !== false}
            />
            <span>활성 — 시간표·출석부·학생목록에 노출</span>
          </label>
        </Field>

        <Field label="메모" className="sm:col-span-2">
          <textarea
            name="notes"
            rows={2}
            defaultValue={defaults?.notes ?? ""}
            placeholder="반 운영에 대한 메모 (선택)"
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <section className="space-y-3 border-t pt-4">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-foreground text-sm font-semibold">주간 스케줄</h3>
            <p className="text-muted-foreground text-xs">
              요일별 시작·종료 시간. 강의실 시간 겹침 자동 감지.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={addSchedule}>
            <Plus className="size-3.5" />
            시간대 추가
          </Button>
        </header>

        {fieldErrs.schedules ? (
          <p className="text-chart-4 text-xs">{fieldErrs.schedules}</p>
        ) : null}

        <ul className="space-y-2">
          {schedules.map((s, i) => (
            <li
              key={i}
              className="border-border bg-card/50 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
            >
              <select
                name={`schedule_day_${i}`}
                value={s.dayOfWeek}
                onChange={(e) => updateSchedule(i, { dayOfWeek: e.target.value })}
                className="border-border bg-card text-foreground rounded-md border px-2 py-1 text-xs"
              >
                {DAYS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}요일
                  </option>
                ))}
              </select>
              <input
                name={`schedule_start_${i}`}
                type="time"
                value={s.startTime}
                onChange={(e) => updateSchedule(i, { startTime: e.target.value })}
                className="border-border bg-card text-foreground num rounded-md border px-2 py-1 text-xs"
              />
              <span className="text-muted-foreground text-xs">~</span>
              <input
                name={`schedule_end_${i}`}
                type="time"
                value={s.endTime}
                onChange={(e) => updateSchedule(i, { endTime: e.target.value })}
                className="border-border bg-card text-foreground num rounded-md border px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => removeSchedule(i)}
                className="text-muted-foreground hover:text-chart-4 ml-auto"
                aria-label="삭제"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
          {schedules.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              스케줄 없이도 반을 생성할 수 있습니다. 나중에 추가 가능합니다.
            </p>
          ) : null}
        </ul>
      </section>

      {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

      <footer className="flex items-center justify-end gap-2 border-t pt-4">
        <Submit mode={mode} />
      </footer>
    </form>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-foreground block text-sm font-medium">{label}</label>
      {children}
      {error ? <p className="text-chart-4 text-xs">{error}</p> : null}
    </div>
  );
}
