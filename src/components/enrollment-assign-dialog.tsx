"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createEnrollment,
  type CreateEnrollmentState,
} from "@/features/enrollments/server/actions";

const SUBJECT_LABEL: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  arts: "예술",
};

export type AssignDialogStudent = {
  id: string;
  name: string;
  grade: string | null;
};

export type AssignDialogClass = {
  id: string;
  className: string;
  subject: string;
  teacherName: string | null;
  studentCount: number;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
      배정
    </Button>
  );
}

/**
 * 수강 배정 모달. 두 가지 모드:
 * - mode="add-class-to-student": 학생 정보가 고정, 반 목록에서 선택
 * - mode="add-student-to-class": 반 정보가 고정, 학생 목록에서 선택
 */
export function EnrollmentAssignDialog({
  open,
  onClose,
  mode,
  student,
  classes,
  studentOptions,
  fixedClass,
  conflicts,
}: {
  open: boolean;
  onClose: (assigned: boolean) => void;
  mode: "add-class-to-student" | "add-student-to-class";
  student?: AssignDialogStudent;
  classes?: AssignDialogClass[];
  studentOptions?: AssignDialogStudent[];
  fixedClass?: AssignDialogClass;
  conflicts?: { day: string; time: string; existingClass: string }[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<CreateEnrollmentState, FormData>(
    createEnrollment,
    undefined,
  );

  if (state?.enrollmentId && !state?.error) {
    queueMicrotask(() => {
      router.refresh();
      onClose(true);
    });
  }

  if (!open) return null;

  const isStudentMode = mode === "add-class-to-student";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">수강 배정</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">
              {isStudentMode ? (
                <>
                  {student?.name}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {student?.grade ?? ""}
                  </span>
                </>
              ) : (
                <>
                  {fixedClass?.className}
                  <span className="text-muted-foreground ml-2 text-xs font-normal">
                    {SUBJECT_LABEL[fixedClass?.subject ?? ""] ?? fixedClass?.subject}
                  </span>
                </>
              )}
            </h2>
            <p className="text-muted-foreground text-xs">
              {isStudentMode ? "배정할 반을 선택하세요" : "배정할 학생을 선택하세요"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-3">
          {isStudentMode && student ? (
            <input type="hidden" name="studentId" value={student.id} />
          ) : null}
          {!isStudentMode && fixedClass ? (
            <input type="hidden" name="classId" value={fixedClass.id} />
          ) : null}

          {isStudentMode && classes ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">반 선택</label>
              <SearchableSelect
                name="classId"
                placeholder="반 선택..."
                searchPlaceholder="반 이름·강사 검색..."
                options={classes.map((c) => ({
                  value: c.id,
                  label: c.className,
                  hint: `${SUBJECT_LABEL[c.subject] ?? c.subject}${c.teacherName ? ` · ${c.teacherName}` : ""} · ${c.studentCount}명`,
                }))}
              />
            </div>
          ) : null}

          {!isStudentMode && studentOptions ? (
            <div className="space-y-1.5">
              <label className="text-foreground block text-sm font-medium">학생 선택</label>
              <SearchableSelect
                name="studentId"
                placeholder="학생 선택..."
                searchPlaceholder="학생 이름 검색..."
                options={studentOptions.map((s) => ({
                  value: s.id,
                  label: s.name,
                  hint: s.grade ?? undefined,
                }))}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-medium">
                시작일
              </label>
              <input
                name="startDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-muted-foreground block text-[11px] font-medium">
                종료일 (선택)
              </label>
              <input
                name="endDate"
                type="date"
                className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
              />
            </div>
          </div>

          {conflicts && conflicts.length > 0 ? (
            <div className="border-chart-4/40 bg-chart-4/5 rounded-md border px-3 py-2 text-xs">
              <div className="text-chart-4 inline-flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                <span className="font-semibold">시간 충돌</span>
              </div>
              <ul className="text-foreground mt-1 space-y-0.5">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {c.day}요일 {c.time} — {c.existingClass}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {state?.error ? <p className="text-chart-4 text-sm">{state.error}</p> : null}

          <footer className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onClose(false)}>
              취소
            </Button>
            <Submit />
          </footer>
        </form>
      </div>
    </div>
  );
}
