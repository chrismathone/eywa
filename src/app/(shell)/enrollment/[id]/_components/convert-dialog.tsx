"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, UserPlus, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore } from "@/components/workspace/window-store";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  convertConsultationToStudent,
  type ConvertToStudentState,
} from "@/features/enrollment/server/actions";

type ClassOption = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
};

function SubmitBtn({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      수업 배정
    </Button>
  );
}

export function ConvertToStudentDialog({
  consultationId,
  defaults,
  classes,
  recommendedIds,
  alreadyConverted,
  linkedStudentId,
}: {
  consultationId: string;
  defaults: {
    name: string;
    grade: string | null;
    school: string | null;
    parentName: string | null;
    parentPhone: string | null;
  };
  classes: ClassOption[];
  recommendedIds: string[];
  alreadyConverted: boolean;
  linkedStudentId: string | null;
}) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const subjects = useSubjectMaps();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ConvertToStudentState, FormData>(
    convertConsultationToStudent,
    undefined,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set(recommendedIds));
  const [classFilter, setClassFilter] = useState("");

  const ql = classFilter.trim().toLowerCase();
  const filteredClasses = ql
    ? classes.filter(
        (c) =>
          c.className.toLowerCase().includes(ql) ||
          (c.teacherName ?? "").toLowerCase().includes(ql) ||
          subjects.labelOf(c.subject).toLowerCase().includes(ql),
      )
    : classes;

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 성공 시 학생 페이지로 이동. 동명이인이라 접미사가 붙었으면 **이동 전에** 알린다 —
  // 조용히 이름을 바꾸면 직원이 나중에 "내가 넣은 이름이 아닌데?" 하고 헤맨다.
  if (state?.studentId && !state?.error) {
    queueMicrotask(() => {
      if (state.notice) toast.warning(state.notice, { duration: 8000 });
      router.push(`/students/${state.studentId}`);
    });
  }

  if (alreadyConverted && linkedStudentId) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          const href = `/students/${linkedStudentId}`;
          if (isDesktop) {
            useWindowStore.getState().open("route", {
              id: `students/${linkedStudentId}`,
              title: defaults.name ?? "학생",
              href,
            });
          } else {
            router.push(href);
          }
        }}
      >
        <UserPlus className="size-4" />
        학생 정보 보기
      </Button>
    );
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        수업 배정
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="bg-background border-border w-full max-w-lg rounded-xl border p-6 shadow-lg">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <p className="eyebrow">상담 → 수업 배정</p>
                <h2 className="text-foreground mt-1 text-lg font-bold">
                  {defaults.name} 수업 배정
                </h2>
                <p className="text-muted-foreground text-xs">
                  학생 정보를 확인하고 배정할 반을 1개 이상 선택하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="닫기"
              >
                <X className="size-4" />
              </button>
            </header>

            <form action={formAction} className="space-y-3">
              <input type="hidden" name="consultationId" value={consultationId} />

              <div className="grid grid-cols-2 gap-2">
                <Field label="이름" name="name" defaultValue={defaults.name} required />
                <Field label="학년" name="grade" defaultValue={defaults.grade ?? ""} />
                <Field label="학교" name="school" defaultValue={defaults.school ?? ""} />
                <Field
                  label="학부모"
                  name="parentName"
                  defaultValue={defaults.parentName ?? ""}
                />
                <Field
                  label="연락처"
                  name="parentPhone"
                  defaultValue={defaults.parentPhone ?? ""}
                  className="col-span-2"
                  mono
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-foreground block text-sm font-medium">
                  배정할 반 (다중 선택, 최소 1개)
                </label>
                {classes.length > 12 ? (
                  <input
                    type="search"
                    value={classFilter}
                    onChange={(e) => setClassFilter(e.target.value)}
                    placeholder="반 이름·강사·과목 검색..."
                    className="border-border bg-card text-foreground placeholder:text-text-faint w-full rounded-md border px-2.5 py-1.5 text-xs focus:outline-none"
                  />
                ) : null}
                <div className="border-border bg-bg-soft/30 max-h-48 overflow-auto rounded-md border p-2">
                  {classes.length === 0 ? (
                    <p className="text-muted-foreground text-xs">활성 반이 없습니다</p>
                  ) : filteredClasses.length === 0 ? (
                    <p className="text-muted-foreground text-xs">검색 결과 없음</p>
                  ) : (
                    <ul className="space-y-1">
                      {filteredClasses.map((c) => {
                        const isSelected = selected.has(c.id);
                        const isRecommended = recommendedIds.includes(c.id);
                        return (
                          <li key={c.id}>
                            <label className="hover:bg-bg-soft flex cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-sm">
                              <input
                                type="checkbox"
                                name="classIds"
                                value={c.id}
                                checked={isSelected}
                                onChange={() => toggle(c.id)}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5">
                                  <span className="text-foreground font-medium">{c.className}</span>
                                  <span className="text-muted-foreground text-[11px]">
                                    {subjects.labelOf(c.subject)}
                                  </span>
                                  {isRecommended ? (
                                    // 추천 = 학생 학년이 반 이름에 들어가는 반(actions.ts gradePrefix 부분일치).
                                    // AI 추론이 아니라 학년 매칭이므로 "학년 추천"으로 정직하게 표기.
                                    <span className="bg-chart-4/10 text-chart-4 border-chart-4/20 rounded-md border px-1 py-0 text-[9px] font-medium">
                                      학년 추천
                                    </span>
                                  ) : null}
                                </div>
                                {c.teacherName ? (
                                  <p className="text-muted-foreground text-[11px]">
                                    {c.teacherName} 강사
                                  </p>
                                ) : null}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <p className="text-muted-foreground text-[11px]">
                  선택한 반으로 학생이 생성되고 수업이 배정됩니다. 반은 나중에 학생 상세에서 추가·변경할 수 있습니다.
                </p>
              </div>

              {state?.error ? (
                <div className="border-chart-4/40 bg-chart-4/5 space-y-2 rounded-md border px-3 py-2">
                  <p className="text-chart-4 text-sm">{state.error}</p>
                  {state.existingStudentId ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const sid = state?.existingStudentId;
                        if (!sid) return;
                        const href = `/students/${sid}`;
                        if (isDesktop) {
                          useWindowStore.getState().open("route", {
                            id: `students/${sid}`,
                            title: defaults.name ?? "학생",
                            href,
                          });
                        } else {
                          router.push(href);
                        }
                      }}
                    >
                      <UserPlus className="size-4" />
                      기존 학생 정보 보기
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {selected.size === 0 ? (
                <p className="text-muted-foreground text-[11px]">배정할 반을 1개 이상 선택해야 합니다.</p>
              ) : null}

              <footer className="flex items-center justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  취소
                </Button>
                <SubmitBtn disabled={selected.size === 0} />
              </footer>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
  mono,
  className,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-muted-foreground block text-[11px] font-medium">{label}</label>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        className={`border-border bg-card text-foreground w-full rounded-md border px-2 py-1.5 text-sm ${mono ? "num" : ""}`}
      />
    </div>
  );
}
