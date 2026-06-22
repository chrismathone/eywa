"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createClass,
  updateClass,
  type ClassFormState,
} from "@/features/classes/server/actions";
import { subjectWeekdayPeriods, type PeriodsConfig } from "@/features/timetable/lib/periods";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { ScheduleGrid } from "./schedule-grid";

// 설정(operations.subjects) 미전달 경로용 폴백 = DEFAULT_SETTINGS.subjects와 동일 키/순서로 유지
// (드리프트 방지). 서버 부모가 subjectOptions를 주면 그 값(=테넌트 설정)이 우선한다.
const DEFAULT_SUBJECT_OPTIONS = [
  { value: "math", label: "수학" },
  { value: "highmath", label: "수학(심화)" },
  { value: "english", label: "영어" },
  { value: "science", label: "과학" },
  { value: "korean", label: "국어" },
];

type Schedule = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  teacherId?: string | null;
  classroomId?: string | null;
};

export type ClassFormDefaults = {
  id?: string;
  className: string;
  subject: string;
  teacherId: string | null;
  classroomId: string | null;
  isActive: boolean;
  notes: string | null;
  bgColor?: string | null;
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
  subjectOptions,
  periodsConfig,
  scope,
}: {
  mode: "create" | "edit";
  defaults?: ClassFormDefaults;
  teacherOptions: { id: string; name: string }[];
  classroomOptions: { id: string; name: string; capacity: number | null }[];
  subjectOptions?: { value: string; label: string }[];
  /** 테넌트 교시설정 → 클릭그리드의 교시→시각. 미전달 시 기본 교시표. */
  periodsConfig?: PeriodsConfig;
  /** 동시 편집 가드 스코프(예: `class:123`). 수정 모드에서만 — 다른 창 저장 시 경고. */
  scope?: string;
}) {
  const subjects = subjectOptions ?? DEFAULT_SUBJECT_OPTIONS;
  const action = mode === "create" ? createClass : updateClass;
  const [state, formAction] = useActionState<ClassFormState, FormData>(action, undefined);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const { notifySaved } = useConcurrentEditGuard({ scope, formRef });

  // 저장 성공 확정(nonce) 후: 동시편집 신호 발화 → 상세로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      notifySaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, router]);

  // 과목은 교시표(8↔10교시)를 좌우하므로 상태로 들어 그리드와 동기. select는 name=subject로 그대로 제출.
  const [subject, setSubject] = useState(defaults?.subject ?? subjects[0]?.value ?? "math");
  const periods = subjectWeekdayPeriods(subject, periodsConfig);
  // 담임도 상태로 — 그리드 셀이 담임 이름을 표시하고, 교시별 부담임 드롭다운의 "담임" 기본값으로 쓴다.
  const [teacherId, setTeacherId] = useState(defaults?.teacherId ?? "");
  // 반 색상(시간표 통합뷰 헤더색) — 빈 문자열=미지정(과목색 폴백). 글자색은 서버가 휘도로 자동.
  const [bgColor, setBgColor] = useState(defaults?.bgColor ?? "");

  const fieldErrs = state?.fieldErrors ?? {};

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
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
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="border-border bg-card text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            {subjects.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="강사">
          <select
            name="teacherId"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
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

        <Field label="반 색상 (시간표 통합뷰)" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            <input type="hidden" name="bgColor" value={bgColor} />
            <input
              type="color"
              value={bgColor || "#1a5f3c"}
              onChange={(e) => setBgColor(e.target.value)}
              className="border-border bg-card size-9 cursor-pointer rounded-md border"
              aria-label="반 배경색"
            />
            {bgColor ? (
              <>
                <span className="text-text-dim font-mono text-xs">{bgColor}</span>
                <button
                  type="button"
                  onClick={() => setBgColor("")}
                  className="text-text-dim hover:text-foreground text-xs underline"
                >
                  색 없음(과목색)
                </button>
              </>
            ) : (
              <span className="text-text-faint text-xs">미지정 — 과목 기본색 사용</span>
            )}
          </div>
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
        <header>
          <h3 className="text-foreground text-sm font-semibold">주간 스케줄</h3>
          <p className="text-muted-foreground text-xs">
            요일 × 교시 칸을 눌러 수업 교시를 지정하세요. 강의실 시간 겹침은 저장 시 자동 감지.
          </p>
        </header>

        {fieldErrs.schedules ? (
          <p className="text-chart-4 text-xs">{fieldErrs.schedules}</p>
        ) : null}

        <ScheduleGrid
          periods={periods}
          initial={defaults?.schedules ?? []}
          teacherId={teacherId || null}
          teacherOptions={teacherOptions}
          classroomOptions={classroomOptions.map((c) => ({ id: c.id, name: c.name }))}
        />
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
