"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import {
  createClass,
  updateClass,
  type ClassFormState,
} from "@/features/classes/server/actions";
import {
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { useConcurrentEditGuard } from "@/components/workspace/use-concurrent-edit-guard";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { conflictToast } from "@/lib/ui/conflict-toast";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { useFormDraft } from "@/components/forms/use-form-draft";
import { DraftBanner } from "@/components/forms/draft-banner";
import { ScheduleGrid } from "./schedule-grid";

// 설정(operations.subjects) 미전달 경로용 폴백 = DEFAULT_SETTINGS.subjects와 동일 키/순서로 유지
// (드리프트 방지). 서버 부모가 subjectOptions를 주면 그 값(=테넌트 설정)이 우선한다.
const DEFAULT_SUBJECT_OPTIONS = [
  { value: "math", label: "수학" },
  // 수학(심화)는 subject_1로 통일(highmath 폐기, 2026-06-19). DEFAULT_SETTINGS.subjects와 키/순서 일치.
  { value: "subject_1", label: "수학(심화)" },
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
  const { markSaved } = useUnsavedGuard({ formRef });

  // 과목은 교시표(8↔10교시)를 좌우하므로 상태로 들어 그리드와 동기. select는 name=subject로 그대로 제출.
  const [subject, setSubject] = useState(defaults?.subject ?? subjects[0]?.value ?? "math");
  const periods = subjectWeekdayPeriods(subject, periodsConfig);
  // 주말(토·일) 교시는 평일과 시각이 달라 그리드에 별도로 넘긴다(주말은 과목 무관 = config.weekend).
  const weekendPeriods = subjectWeekendPeriods(periodsConfig);
  // 담임도 상태로 — 그리드 셀이 담임 이름을 표시하고, 교시별 부담임 드롭다운의 "담임" 기본값으로 쓴다.
  const [teacherId, setTeacherId] = useState(defaults?.teacherId ?? "");
  // 반 색상(시간표 통합뷰 헤더색) — 빈 문자열=미지정(과목색 폴백). 글자색은 서버가 휘도로 자동.
  const [bgColor, setBgColor] = useState(defaults?.bgColor ?? "");
  // 초안 복원용 — 복원된 스케줄을 그리드 initial로 주고 key를 바꿔 remount(그리드는 initial을 마운트 1회만 읽음).
  const [restoredSchedules, setRestoredSchedules] = useState<Schedule[] | null>(null);
  const [gridKey, setGridKey] = useState(0);

  // 로컬 초안 자동저장 — 스케줄(그리드 hidden input schedule_*_${i})·과목·담임·색까지 onRestore로 rehydrate.
  const draft = useFormDraft({
    scope: mode === "create" ? "class:new" : `class:${defaults?.id ?? "edit"}`,
    formRef,
    onRestore: (vals) => {
      if (vals.subject) setSubject(vals.subject);
      setTeacherId(vals.teacherId ?? "");
      setBgColor(vals.bgColor ?? "");
      // schedule_*_${i} 인덱스 hidden을 스케줄 배열로 복원 → 그리드 remount.
      const sched: Schedule[] = [];
      for (let i = 0; vals[`schedule_day_${i}`] !== undefined; i++) {
        sched.push({
          dayOfWeek: vals[`schedule_day_${i}`]!,
          startTime: vals[`schedule_start_${i}`] ?? "",
          endTime: vals[`schedule_end_${i}`] ?? "",
          teacherId: vals[`schedule_teacher_${i}`] || null,
          classroomId: vals[`schedule_classroom_${i}`] || null,
        });
      }
      setRestoredSchedules(sched);
      setGridKey((k) => k + 1);
    },
  });
  const clearDraft = draft.clear;

  // 저장 성공 확정(nonce) 후: 초안 삭제 → 동시편집 신호 발화 → 상세로 이동(서버 redirect 대체, B-2).
  const handledNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state?.ok && state.nonce && state.nonce !== handledNonce.current) {
      handledNonce.current = state.nonce;
      clearDraft();
      notifySaved();
      markSaved();
      if (state.redirectTo) router.push(state.redirectTo);
    }
  }, [state, notifySaved, markSaved, router, clearDraft]);

  // 강의실/강사 시간 충돌 등 저장 차단 경고 — 폼 하단 작은 텍스트를 놓치지 않게 가운데(top-center) 토스트 병행.
  // state 참조가 바뀔 때(=매 제출 결과)만 발화 → 같은 충돌 재제출도 다시 알림.
  const notifiedState = useRef<ClassFormState>(undefined);
  useEffect(() => {
    if (state === notifiedState.current) return;
    notifiedState.current = state;
    if (state?.error) conflictToast(state.error);
    else if (state?.teacherConflict) conflictToast(`강사 시간 겹침: ${state.teacherConflict}`);
  }, [state]);

  const fieldErrs = state?.fieldErrors ?? {};

  return (
    <form action={formAction} ref={formRef} className="space-y-5">
      <DraftBanner savedAt={draft.draftSavedAt} onRestore={draft.restore} onDiscard={draft.discard} />
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

        <Field label="반 색상 (시간표·스케줄)" className="sm:col-span-2">
          <div className="flex items-center gap-3">
            <input type="hidden" name="bgColor" value={bgColor} />
            <input
              type="color"
              value={bgColor || "#153e75"}
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

{/* '활성' 체크박스 폐지(2026-07-21 원장 확정) — 같은 `is_active`를 쓰는 문이 둘인데 **뒷정리는 하나만**
    했다. '반 폐지' 버튼은 그 반 활성 수강도 함께 종료하는데, 이 체크박스는 플래그만 꺼서 시간표·출석부에선
    사라지지만 **학생목록·학생상세엔 "수강중"으로 남는** 사각지대를 되살렸다(2026-07-15에 고친 그 버그).
    라벨의 "학생목록에 노출"도 이 경로에선 거짓이었다. → 끄고 켜는 것은 **반 상세의 '반 폐지/재운영' 단일 경로**로. */}
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
          <h3 className="text-foreground text-sm font-bold">주간 스케줄</h3>
          <p className="text-muted-foreground text-xs">
            요일 × 교시 칸을 눌러 수업 교시를 지정하세요. 강의실·강사 시간 겹침은 저장 시 자동 감지(강사 겹침은 합반 등 의도 시 무시 가능).
          </p>
        </header>

        {fieldErrs.schedules ? (
          <p className="text-chart-4 text-xs">{fieldErrs.schedules}</p>
        ) : null}

        <ScheduleGrid
          key={gridKey}
          weekdayPeriods={periods}
          weekendPeriods={weekendPeriods}
          initial={restoredSchedules ?? defaults?.schedules ?? []}
          teacherId={teacherId || null}
          teacherOptions={teacherOptions}
          classroomOptions={classroomOptions.map((c) => ({ id: c.id, name: c.name }))}
          bgColor={bgColor || null}
        />
      </section>

      {state?.teacherConflict ? (
        <div className="border-amber/30 bg-amber/10 rounded-md border px-3 py-2.5">
          <p className="text-amber flex items-start gap-1.5 text-sm font-medium">
            <EyIcon name="alert" size={16} className="mt-0.5 shrink-0" />
            <span>강사 시간 겹침: {state.teacherConflict}</span>
          </p>
          <p className="text-text-dim mt-0.5 text-xs">
            합반 등 의도된 겹침이면 아래 “겹침 무시하고 저장”을 누르세요. 아니면 강사·시간을 조정하세요.
          </p>
        </div>
      ) : null}
      {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

      <FormActionBar>
        <Submit mode={mode} />
        {state?.teacherConflict ? (
          <Button type="submit" variant="outline" name="ignoreTeacherConflict" value="1">
            겹침 무시하고 저장
          </Button>
        ) : null}
      </FormActionBar>
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
