"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/components/workspace/use-is-desktop";
import { useWindowStore } from "@/components/workspace/window-store";
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

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

function SubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      학생 등록
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
          (SUBJECT_LABEL[c.subject] ?? c.subject).toLowerCase().includes(ql),
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

  // 성공 시 학생 페이지로 이동
  if (state?.studentId && !state?.error) {
    queueMicrotask(() => router.push(`/students/${state.studentId}`));
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
        학생 등록 완료
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="bg-background border-border w-full max-w-lg rounded-lg border p-6 shadow-lg">
            <header className="mb-4 flex items-start justify-between">
              <div>
                <p className="eyebrow">상담 → 학생 전환</p>
                <h2 className="text-foreground mt-1 text-lg font-semibold">
                  {defaults.name} 학생 등록
                </h2>
                <p className="text-muted-foreground text-xs">
                  학생 정보를 확인하고 배정할 반을 선택하세요.
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
                  배정할 반 (다중 선택)
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
                                    {SUBJECT_LABEL[c.subject] ?? c.subject}
                                  </span>
                                  {isRecommended ? (
                                    <span className="bg-chart-4/10 text-chart-4 border-chart-4/20 rounded-md border px-1 py-0 text-[9px] font-medium">
                                      AI 추천
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
                  선택하지 않아도 등록 가능합니다. 나중에 학생 상세에서 추가할 수 있습니다.
                </p>
              </div>

              {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

              <footer className="flex items-center justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  취소
                </Button>
                <SubmitBtn />
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
